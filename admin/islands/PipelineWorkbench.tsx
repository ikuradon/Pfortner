/** @jsxImportSource preact */
import { useEffect, useReducer } from 'preact/hooks';
import { graphToPipelines, pipelinesToGraph } from '../static/pipeline_graph.js';
import {
  buildPipelineDraft,
  fingerprintPipelines,
  getWorkbenchChangeState,
  LOCAL_DRAFT_KEY,
} from '../static/pipeline_workbench_state.js';
import { Canvas } from './pipeline/Canvas.tsx';
import {
  evaluatePipeline,
  fetchAdminConfig,
  fetchAdminPlugins,
  fetchPipelineDraft,
  publishPipelines,
  savePipelineDraft,
} from './pipeline/api_client.ts';
import { DEFAULT_PLUGINS } from './pipeline/defaults.ts';
import { NodeSettingsModal } from './pipeline/NodeSettingsModal.tsx';
import { Palette } from './pipeline/Palette.tsx';
import { PlaygroundModal } from './pipeline/PlaygroundModal.tsx';
import { PublishModal } from './pipeline/PublishModal.tsx';
import { Toolbar } from './pipeline/Toolbar.tsx';
import {
  createInitialWorkbenchState,
  reduceWorkbench,
  selectWorkbenchDraft,
  validateWorkbenchGraphsForPublish,
} from './pipeline/workbench_reducer.ts';

const EMPTY_PIPELINES = { client: [], server: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        stableValue((value as Record<string, unknown>)[key]),
      ]),
    );
  }
  return value;
}

function draftFingerprintFromParts(graphs: unknown, viewports: unknown): string {
  return JSON.stringify(stableValue({ graphs, viewports }));
}

function pipelinesFromConfig(config: unknown): unknown {
  return isRecord(config) && isRecord(config.pipelines) ? config.pipelines : EMPTY_PIPELINES;
}

function pipelinesFromResponse(data: unknown, fallback: unknown): unknown {
  return isRecord(data) && isRecord(data.pipelines) ? data.pipelines : fallback;
}

function readLocalDraft(): unknown | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    const raw = globalThis.localStorage.getItem(LOCAL_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalDraft(draft: unknown): boolean {
  try {
    if (typeof globalThis.localStorage === 'undefined') return false;
    globalThis.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function formatPlaygroundResult(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

function createInitialState() {
  return createInitialWorkbenchState({
    graphs: pipelinesToGraph(EMPTY_PIPELINES),
    plugins: DEFAULT_PLUGINS,
    publishedFingerprint: fingerprintPipelines(EMPTY_PIPELINES),
  });
}

function noop(): void {
  return undefined;
}

function ignorePolicy(_policy: string): void {
  return undefined;
}

function ignoreNodePointer(_nodeId: string, _event: PointerEvent): void {
  return undefined;
}

export default function PipelineWorkbench() {
  const [state, dispatch] = useReducer(reduceWorkbench, createInitialState());
  const title = state.direction === 'client' ? 'Client Pipeline' : 'Server Pipeline';
  const workbenchClass = state.ui.paletteCollapsed ? 'pipeline-workbench palette-collapsed' : 'pipeline-workbench';
  const activeModal = state.ui.activeModal;
  const serializedPipelines = graphToPipelines(state.graphs);
  const currentDraftFingerprint = draftFingerprintFromParts(
    state.graphs,
    state.viewports,
  );
  const changeState = getWorkbenchChangeState({
    currentDraftFingerprint,
    savedDraftFingerprint: state.savedDraftFingerprint,
    currentPipelineFingerprint: fingerprintPipelines(serializedPipelines),
    publishedFingerprint: state.publishedFingerprint,
  });
  const settingsNode = activeModal.type === 'settings'
    ? state.graphs[state.direction].nodes.find((node) => node.id === activeModal.nodeId)
    : undefined;

  useEffect(() => {
    let active = true;

    (async () => {
      const [config, plugins, draft] = await Promise.all([
        fetchAdminConfig(),
        fetchAdminPlugins().catch(() => ({ plugins: DEFAULT_PLUGINS })),
        fetchPipelineDraft().catch(() => null),
      ]);
      if (!active) return;
      const selectedDraft = selectWorkbenchDraft([draft, readLocalDraft()]);
      dispatch({
        type: 'initialDataLoaded',
        pipelines: pipelinesFromConfig(config),
        plugins: plugins.plugins,
        draft: 'draft' in selectedDraft ? selectedDraft.draft : null,
      });
    })().catch((error) => {
      if (!active) return;
      dispatch({
        type: 'loadFailed',
        message: `Workbench load failed: ${errorMessage(error)}`,
      });
    });

    return () => {
      active = false;
    };
  }, []);

  async function handleSave(): Promise<void> {
    const draft = buildPipelineDraft({
      graphs: state.graphs,
      viewports: state.viewports,
      publishedFingerprint: state.publishedFingerprint,
      now: Date.now(),
    });
    const savedDraftFingerprint = draftFingerprintFromParts(
      state.graphs,
      state.viewports,
    );
    const localSaved = writeLocalDraft(draft);

    try {
      await savePipelineDraft(draft);
      dispatch({
        type: 'draftSaved',
        message: 'DAG saved',
        kind: 'success',
        savedDraftFingerprint,
      });
    } catch (error) {
      if (localSaved) {
        dispatch({
          type: 'draftSaved',
          message: `DAG saved locally; server draft failed: ${errorMessage(error)}`,
          kind: 'warning',
          savedDraftFingerprint,
        });
        return;
      }
      dispatch({
        type: 'loadFailed',
        message: `DAG save failed: ${errorMessage(error)}`,
      });
    }
  }

  async function handleLoad(): Promise<void> {
    let draft: unknown | null = null;
    let serverError = '';

    try {
      draft = await fetchPipelineDraft();
    } catch (error) {
      serverError = errorMessage(error);
    }

    if (draft === null) {
      draft = readLocalDraft();
    }

    if (draft === null) {
      dispatch({
        type: 'loadFailed',
        message: serverError ? `No saved DAG found; server draft failed: ${serverError}` : 'No saved DAG found.',
      });
      return;
    }

    const selectedDraft = selectWorkbenchDraft([draft, readLocalDraft()]);
    if ('error' in selectedDraft) {
      dispatch({
        type: 'loadFailed',
        message: `Draft load failed: ${selectedDraft.error}`,
      });
      return;
    }

    dispatch({
      type: 'graphsLoaded',
      graphs: selectedDraft.draft.graphs,
      viewports: selectedDraft.draft.viewports,
      message: 'Loaded saved DAG',
      savedDraftFingerprint: draftFingerprintFromParts(
        selectedDraft.draft.graphs,
        selectedDraft.draft.viewports,
      ),
    });
  }

  async function handlePublishConfirm(): Promise<void> {
    const validationError = validateWorkbenchGraphsForPublish(state.graphs);
    if (validationError) {
      dispatch({
        type: 'loadFailed',
        message: validationError,
      });
      return;
    }
    const serialized = graphToPipelines(state.graphs);

    try {
      const data = await publishPipelines(serialized);
      dispatch({
        type: 'published',
        pipelines: pipelinesFromResponse(data, serialized),
        message: 'Pipeline published',
      });
    } catch (error) {
      dispatch({
        type: 'loadFailed',
        message: `Pipeline publish failed: ${errorMessage(error)}`,
      });
    }
  }

  async function handlePlaygroundRun(rawMessage: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch (error) {
      dispatch({
        type: 'playgroundFailed',
        message: `Invalid JSON: ${errorMessage(error)}`,
      });
      return;
    }

    if (!Array.isArray(message)) {
      dispatch({
        type: 'playgroundFailed',
        message: 'Message must be a JSON array.',
      });
      return;
    }

    const serialized = graphToPipelines(state.graphs);
    try {
      const result = await evaluatePipeline({
        pipeline: serialized[state.direction] ?? [],
        message,
        direction: state.direction,
        connectionInfo: {},
      });
      dispatch({ type: 'playgroundResultLoaded', result });
    } catch (error) {
      dispatch({
        type: 'playgroundFailed',
        message: `Playground request failed: ${errorMessage(error)}`,
      });
    }
  }

  return (
    <div class={workbenchClass} id='pipeline-workbench'>
      <Toolbar
        direction={state.direction}
        onDirectionChange={(direction) => dispatch({ type: 'directionChanged', direction })}
        onRun={noop}
        onLoad={handleLoad}
        onSave={handleSave}
        onPublish={() => dispatch({ type: 'publishModalOpened' })}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
      />
      <span class='workbench-state-badges'>
        <span class='text-muted' id='workbench-status-summary'>
          {state.status.message}
        </span>
        <span
          class={changeState.hasUnsavedDagChanges ? 'badge badge-warning' : 'badge badge-success'}
          id='workbench-save-state'
        >
          {changeState.dagLabel}
        </span>
        <span
          class={changeState.hasUnpublishedChanges ? 'badge badge-warning' : 'badge badge-success'}
          id='workbench-publish-state'
        >
          {changeState.publishLabel}
        </span>
      </span>
      <div id='pipeline-status' class='workbench-status'></div>
      <div class='workbench-grid canvas-first-grid' id='canvas-first-grid'>
        <Palette
          plugins={state.plugins}
          collapsed={state.ui.paletteCollapsed}
          onToggle={() => dispatch({ type: 'paletteToggled' })}
          onAdd={ignorePolicy}
        />
        <section class='canvas-shell canvas-shell-expanded'>
          <div class='canvas-toolbar'>
            <span id='canvas-title'>{title}</span>
            <span class='text-muted' id='canvas-zoom-label'>100%</span>
          </div>
          <Canvas
            graph={state.graphs[state.direction]}
            selectedNodeIds={state.selectedNodeIds}
            onNodePointerDown={ignoreNodePointer}
            onNodeDoubleClick={(nodeId) => dispatch({ type: 'nodeDoubleClicked', nodeId })}
          />
        </section>
      </div>
      {activeModal.type === 'settings' && settingsNode
        ? (
          <NodeSettingsModal
            node={settingsNode}
            mode={activeModal.mode}
            json={activeModal.json}
            error={activeModal.error}
            onModeChange={(mode) => dispatch({ type: 'settingsModeChanged', mode })}
            onJsonChange={(value) => dispatch({ type: 'settingsJsonChanged', value })}
            onApply={() => dispatch({ type: 'settingsApplied' })}
            onClose={() => dispatch({ type: 'modalClosed' })}
          />
        )
        : null}
      {activeModal.type === 'playground'
        ? (
          <PlaygroundModal
            nodeId={activeModal.nodeId}
            result={activeModal.result === undefined ? undefined : formatPlaygroundResult(activeModal.result)}
            error={activeModal.error}
            onRun={handlePlaygroundRun}
            onClose={() => dispatch({ type: 'modalClosed' })}
          />
        )
        : null}
      {activeModal.type === 'publish'
        ? (
          <PublishModal
            yaml={activeModal.yaml}
            validationError={validateWorkbenchGraphsForPublish(state.graphs)}
            onConfirm={handlePublishConfirm}
            onClose={() => dispatch({ type: 'modalClosed' })}
          />
        )
        : null}
    </div>
  );
}
