/** @jsxImportSource preact */
import { useEffect, useReducer } from 'preact/hooks';
import { graphToPipelines, pipelinesToGraph } from './pipeline/graph.js';
import { fingerprintPipelines, getWorkbenchChangeState } from './pipeline/workbench_state.js';
import { Canvas } from './pipeline/Canvas.tsx';
import { fetchAdminConfig, fetchAdminPlugins } from './pipeline/api_client.ts';
import {
  createBrowserWorkbenchActionServices,
  loadWorkbenchDraft,
  publishWorkbenchGraphs,
  runWorkbenchPlayground,
  saveWorkbenchDraft,
} from './pipeline/workbench_actions.ts';
import { DEFAULT_PLUGINS } from './pipeline/defaults.ts';
import { NodeSettingsModal } from './pipeline/NodeSettingsModal.tsx';
import { Palette } from './pipeline/Palette.tsx';
import { PlaygroundModal } from './pipeline/PlaygroundModal.tsx';
import { PublishModal } from './pipeline/PublishModal.tsx';
import { Toolbar } from './pipeline/Toolbar.tsx';
import { DEFAULT_CANVAS_SIZE } from './pipeline/minimap.ts';
import { fitViewportToGraph, zoomViewportByStep } from './pipeline/use_canvas_interactions.ts';
import {
  createInitialWorkbenchState,
  reduceWorkbench,
  selectWorkbenchDraft,
  validateWorkbenchGraphsForPublish,
} from './pipeline/workbench_reducer.ts';
import type { PipelineGraph, Point, Rect, Viewport } from './pipeline/types.ts';

const EMPTY_PIPELINES = { client: [], server: [] };
const NODE_GAP = 240;

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

function isStartGraphNode(node: { type?: string; policy?: string } | null | undefined): boolean {
  return node?.type === 'start' || node?.policy === 'start';
}

function nextPalettePosition(graph: PipelineGraph) {
  const start = graph.nodes.find(isStartGraphNode);
  if (!start) return { x: NODE_GAP, y: 80 };
  return {
    x: (start.x ?? 0) + NODE_GAP,
    y: start.y ?? 80,
  };
}

const WORKBENCH_ACTION_SERVICES = createBrowserWorkbenchActionServices();

function currentCanvasSize() {
  if (typeof document === 'undefined') return DEFAULT_CANVAS_SIZE;
  const rect = document.getElementById('pipeline-svg')?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return DEFAULT_CANVAS_SIZE;
  return { width: rect.width, height: rect.height };
}

export default function PipelineWorkbench() {
  const [state, dispatch] = useReducer(reduceWorkbench, createInitialState());
  const title = state.direction === 'client' ? 'Client Pipeline' : 'Server Pipeline';
  const workbenchClass = state.ui.paletteCollapsed ? 'pipeline-workbench palette-collapsed' : 'pipeline-workbench';
  const activeModal = state.ui.activeModal;
  const activeViewport = state.viewports[state.direction];
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
        WORKBENCH_ACTION_SERVICES.fetchPipelineDraft().catch(() => null),
      ]);
      if (!active) return;
      const selectedDraft = selectWorkbenchDraft([draft, WORKBENCH_ACTION_SERVICES.readLocalDraft()]);
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
    await saveWorkbenchDraft(state, WORKBENCH_ACTION_SERVICES, dispatch);
  }

  async function handleLoad(): Promise<void> {
    await loadWorkbenchDraft(WORKBENCH_ACTION_SERVICES, dispatch);
  }

  async function handlePublishConfirm(): Promise<void> {
    await publishWorkbenchGraphs(state, WORKBENCH_ACTION_SERVICES, dispatch);
  }

  async function handlePlaygroundRun(rawMessage: string): Promise<void> {
    await runWorkbenchPlayground(state, rawMessage, WORKBENCH_ACTION_SERVICES, dispatch);
  }

  function handleViewportChange(viewport: Viewport): void {
    dispatch({
      type: 'viewportChanged',
      zoom: viewport.zoom,
      pan: viewport.pan,
    });
  }

  function handleFitCanvas(): void {
    handleViewportChange(
      fitViewportToGraph(
        state.graphs[state.direction],
        currentCanvasSize(),
      ),
    );
  }

  function handleZoomStep(step: number): void {
    handleViewportChange(zoomViewportByStep(activeViewport, step));
  }

  function handleNodeSelect(nodeId: string, additive: boolean): void {
    dispatch({
      type: 'nodeSelected',
      nodeId,
      additive,
    });
  }

  function handleSelectionReplace(nodeIds: string[]): void {
    dispatch({
      type: 'selectionReplaced',
      nodeIds,
    });
  }

  function handleMarqueeChange(rect: Rect | null): void {
    dispatch({
      type: 'marqueeChanged',
      rect,
    });
  }

  function handleNodeMove(nodeId: string, position: Point): void {
    dispatch({
      type: 'nodeMoved',
      nodeId,
      x: position.x,
      y: position.y,
    });
  }

  function handleEdgeReplace(from: string, fromPort: string, to: string): void {
    dispatch({
      type: 'edgeReplaced',
      from,
      fromPort,
      to,
    });
  }

  return (
    <div class={workbenchClass} id='pipeline-workbench'>
      <div class='pipeline-mode-bar' aria-label='Pipeline direction'>
        <button
          type='button'
          id='tab-client'
          class={state.direction === 'client' ? 'btn btn-primary pipeline-mode-tab' : 'btn btn-ghost pipeline-mode-tab'}
          data-pipeline='client'
          aria-pressed={state.direction === 'client'}
          onClick={() => dispatch({ type: 'directionChanged', direction: 'client' })}
        >
          Client
        </button>
        <button
          type='button'
          id='tab-server'
          class={state.direction === 'server' ? 'btn btn-primary pipeline-mode-tab' : 'btn btn-ghost pipeline-mode-tab'}
          data-pipeline='server'
          aria-pressed={state.direction === 'server'}
          onClick={() => dispatch({ type: 'directionChanged', direction: 'server' })}
        >
          Server
        </button>
      </div>
      <Toolbar
        onRun={noop}
        onLoad={handleLoad}
        onSave={handleSave}
        onPublish={() => dispatch({ type: 'publishModalOpened' })}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onFit={handleFitCanvas}
        onZoomOut={() => handleZoomStep(-0.1)}
        onZoomIn={() => handleZoomStep(0.1)}
        canUndo={state.history[state.direction].past.length > 0}
        canRedo={state.history[state.direction].future.length > 0}
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
          onAdd={(policy) =>
            dispatch({
              type: 'policyNodeAdded',
              policy,
              position: nextPalettePosition(state.graphs[state.direction]),
            })}
        />
        <section class='canvas-shell canvas-shell-expanded'>
          <div class='canvas-toolbar'>
            <span id='canvas-title'>{title}</span>
            <span class='text-muted' id='canvas-zoom-label'>{Math.round(activeViewport.zoom * 100)}%</span>
          </div>
          <Canvas
            graph={state.graphs[state.direction]}
            selectedNodeIds={state.selectedNodeIds}
            marquee={state.ui.marquee}
            viewport={activeViewport}
            onViewportChange={handleViewportChange}
            onNodeSelect={handleNodeSelect}
            onSelectionReplace={handleSelectionReplace}
            onMarqueeChange={handleMarqueeChange}
            onNodeMove={handleNodeMove}
            onEdgeReplace={handleEdgeReplace}
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
