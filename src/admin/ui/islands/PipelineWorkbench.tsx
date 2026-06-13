/** @jsxImportSource preact */
import { useEffect, useReducer, useState } from 'preact/hooks';
import { graphToPipelines, pipelinesToGraph } from './pipeline/graph.js';
import {
  dagFingerprintFromGraphs,
  fingerprintPipelines,
  getWorkbenchChangeState,
  LAST_DIRECTION_KEY,
  PALETTE_COLLAPSED_KEY,
} from './pipeline/workbench_state.js';
import { Canvas } from './pipeline/Canvas.tsx';
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
import { ViewportControls } from './pipeline/ViewportControls.tsx';
import { DEFAULT_CANVAS_SIZE } from './pipeline/minimap.ts';
import { fitViewportToGraph, zoomViewportByStep } from './pipeline/use_canvas_interactions.ts';
import { useWorkbenchKeyboard } from './pipeline/use_workbench_keyboard.ts';
import {
  createInitialWorkbenchState,
  reduceWorkbench,
  selectWorkbenchDraft,
  validateWorkbenchGraphsForPublish,
} from './pipeline/workbench_reducer.ts';
import type {
  PipelineGraph,
  PlaygroundConnectionInfo,
  PlaygroundRunRequest,
  Point,
  Rect,
  Viewport,
  WirePreview,
} from './pipeline/types.ts';

const EMPTY_PIPELINES = { client: [], server: [] };
const NODE_GAP = 240;

interface PipelineWorkbenchProps {
  initialPipelines?: unknown;
  initialPlugins?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pipelinesFromValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : EMPTY_PIPELINES;
}

function pluginsFromValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_PLUGINS];
  const plugins = value.filter((item): item is string => typeof item === 'string');
  return plugins.length > 0 ? plugins : [...DEFAULT_PLUGINS];
}

function createInitialState(props: PipelineWorkbenchProps) {
  const initialPipelines = pipelinesFromValue(props.initialPipelines);
  const graphs = pipelinesToGraph(initialPipelines);
  return createInitialWorkbenchState({
    graphs,
    plugins: pluginsFromValue(props.initialPlugins),
    publishedFingerprint: fingerprintPipelines(graphToPipelines(graphs)),
  });
}

function isStartGraphNode(
  node: { type?: string; policy?: string } | null | undefined,
): boolean {
  return node?.type === 'start' || node?.policy === 'start';
}

function nextPalettePosition(graph: PipelineGraph) {
  const start = graph.nodes.find(isStartGraphNode);
  if (!start) return { x: NODE_GAP, y: 80 };
  const policyNodes = graph.nodes.filter((node) => !isStartGraphNode(node));
  if (policyNodes.length > 0) {
    const rightMost = policyNodes.reduce((current, node) => (node.x ?? 0) > (current.x ?? 0) ? node : current);
    return {
      x: (rightMost.x ?? 0) + NODE_GAP,
      y: rightMost.y ?? start.y ?? 80,
    };
  }
  return {
    x: (start.x ?? 0) + NODE_GAP,
    y: start.y ?? 80,
  };
}

const WORKBENCH_ACTION_SERVICES = createBrowserWorkbenchActionServices();

const DEFAULT_PLAYGROUND_CONTEXT: PlaygroundConnectionInfo = {
  authenticated: false,
  pubkey: '',
  clientIp: '127.0.0.1',
};

function currentCanvasSize() {
  if (typeof document === 'undefined') return DEFAULT_CANVAS_SIZE;
  const rect = document.getElementById('pipeline-svg')?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return DEFAULT_CANVAS_SIZE;
  return { width: rect.width, height: rect.height };
}

function readStorageItem(key: string): string | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key: string, value: string): void {
  try {
    if (typeof globalThis.localStorage === 'undefined') return;
    globalThis.localStorage.setItem(key, value);
  } catch {
    // localStorage が使えない環境では永続化だけ諦める。
  }
}

export default function PipelineWorkbench(props: PipelineWorkbenchProps = {}) {
  const [state, dispatch] = useReducer(
    reduceWorkbench,
    createInitialState(props),
  );
  const [playgroundMessage, setPlaygroundMessage] = useState('');
  const [playgroundConnectionInfo, setPlaygroundConnectionInfo] = useState(
    DEFAULT_PLAYGROUND_CONTEXT,
  );
  const title = state.direction === 'client' ? 'Client Pipeline' : 'Server Pipeline';
  const workbenchClass = state.ui.paletteCollapsed ? 'pipeline-workbench palette-collapsed' : 'pipeline-workbench';
  const activeModal = state.ui.activeModal;
  const activeViewport = state.viewports[state.direction];
  const serializedPipelines = graphToPipelines(state.graphs);
  const currentDraftFingerprint = dagFingerprintFromGraphs(state.graphs);
  const changeState = getWorkbenchChangeState({
    currentDraftFingerprint,
    savedDraftFingerprint: state.savedDraftFingerprint,
    currentPipelineFingerprint: fingerprintPipelines(serializedPipelines),
    publishedFingerprint: state.publishedFingerprint,
  });
  const settingsNode = activeModal.type === 'settings'
    ? state.graphs[state.direction].nodes.find((node) => node.id === activeModal.nodeId)
    : undefined;

  useWorkbenchKeyboard(state, dispatch);

  useEffect(() => {
    dispatch({
      type: 'palettePreferenceLoaded',
      collapsed: readStorageItem(PALETTE_COLLAPSED_KEY) === 'true',
    });
    const storedDirection = readStorageItem(LAST_DIRECTION_KEY);
    if (storedDirection === 'client' || storedDirection === 'server') {
      dispatch({
        type: 'directionPreferenceLoaded',
        direction: storedDirection,
      });
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const serverDraft = await WORKBENCH_ACTION_SERVICES.fetchPipelineDraft()
        .catch(() => null);
      if (!active) return;
      const localDraft = WORKBENCH_ACTION_SERVICES.readLocalDraft();
      if (serverDraft === null && localDraft === null) return;
      const selectedDraft = selectWorkbenchDraft([
        serverDraft,
        localDraft,
      ], { publishedFingerprint: state.publishedFingerprint });
      if ('error' in selectedDraft) return;
      dispatch({
        type: 'graphsLoaded',
        graphs: selectedDraft.draft.graphs,
        viewports: selectedDraft.draft.viewports,
        message: 'Loaded saved DAG',
        savedDraftFingerprint: dagFingerprintFromGraphs(selectedDraft.draft.graphs),
      });
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleSave(): Promise<void> {
    await saveWorkbenchDraft(state, WORKBENCH_ACTION_SERVICES, dispatch);
  }

  async function handleLoad(): Promise<void> {
    await loadWorkbenchDraft(
      WORKBENCH_ACTION_SERVICES,
      dispatch,
      { publishedFingerprint: state.publishedFingerprint },
    );
  }

  async function handlePublishConfirm(): Promise<void> {
    await publishWorkbenchGraphs(state, WORKBENCH_ACTION_SERVICES, dispatch);
  }

  async function handlePlaygroundRun(request: PlaygroundRunRequest): Promise<void> {
    await runWorkbenchPlayground(
      state,
      request,
      WORKBENCH_ACTION_SERVICES,
      dispatch,
    );
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

  function handleDirectionChange(direction: 'client' | 'server'): void {
    dispatch({ type: 'directionChanged', direction });
    writeStorageItem(LAST_DIRECTION_KEY, direction);
  }

  function handlePaletteToggle(): void {
    const collapsed = !state.ui.paletteCollapsed;
    dispatch({ type: 'paletteToggled' });
    writeStorageItem(PALETTE_COLLAPSED_KEY, collapsed ? 'true' : 'false');
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

  function handleNodeMove(
    nodeId: string,
    position: Point,
    transient = false,
  ): void {
    dispatch({
      type: 'nodeMoved',
      nodeId,
      x: position.x,
      y: position.y,
      transient,
    });
  }

  function handleNodeDragCommit(nodeIds: string[]): void {
    dispatch({
      type: 'nodeDragCommitted',
      nodeIds,
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

  function handleWirePreviewChange(preview: WirePreview | null): void {
    dispatch({
      type: 'wirePreviewChanged',
      preview,
    });
  }

  return (
    <div class={workbenchClass} id='pipeline-workbench'>
      <div class='page-header pipeline-page-header'>
        <h1 class='page-title'>Pipelines</h1>
        <div class='pipeline-mode-bar' aria-label='Pipeline direction'>
          <button
            type='button'
            id='tab-client'
            class={state.direction === 'client'
              ? 'btn btn-primary pipeline-mode-tab'
              : 'btn btn-ghost pipeline-mode-tab'}
            data-pipeline='client'
            aria-pressed={state.direction === 'client'}
            onClick={() => handleDirectionChange('client')}
          >
            Client
          </button>
          <button
            type='button'
            id='tab-server'
            class={state.direction === 'server'
              ? 'btn btn-primary pipeline-mode-tab'
              : 'btn btn-ghost pipeline-mode-tab'}
            data-pipeline='server'
            aria-pressed={state.direction === 'server'}
            onClick={() => handleDirectionChange('server')}
          >
            Server
          </button>
        </div>
      </div>
      <div class='workbench-command-bar'>
        <Toolbar
          onLoad={handleLoad}
          onSave={handleSave}
          onPublish={() => dispatch({ type: 'publishModalOpened' })}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
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
      </div>
      <div class='workbench-grid canvas-first-grid' id='canvas-first-grid'>
        <Palette
          plugins={state.plugins}
          collapsed={state.ui.paletteCollapsed}
          onToggle={handlePaletteToggle}
          onAdd={(policy) => dispatch({
            type: 'policyNodeAdded',
            policy,
            position: nextPalettePosition(state.graphs[state.direction]),
          })}
        />
        <section class='canvas-shell canvas-shell-expanded'>
          <div class='canvas-toolbar'>
            <span id='canvas-title'>{title}</span>
            <span class='text-muted' id='canvas-zoom-label'>
              {Math.round(activeViewport.zoom * 100)}%
            </span>
          </div>
          <ViewportControls
            onFit={handleFitCanvas}
            onZoomOut={() => handleZoomStep(-0.1)}
            onZoomIn={() => handleZoomStep(0.1)}
          />
          <Canvas
            graph={state.graphs[state.direction]}
            selectedNodeIds={state.selectedNodeIds}
            executionNodeIds={state.executionNodeIdsByDirection[state.direction]}
            wirePreview={state.ui.wirePreview}
            marquee={state.ui.marquee}
            viewport={activeViewport}
            onViewportChange={handleViewportChange}
            onNodeSelect={handleNodeSelect}
            onSelectionReplace={handleSelectionReplace}
            onMarqueeChange={handleMarqueeChange}
            onNodeMove={handleNodeMove}
            onNodeDragCommit={handleNodeDragCommit}
            onEdgeReplace={handleEdgeReplace}
            onEdgeRemove={(edgeId) => dispatch({ type: 'edgeRemoved', edgeId })}
            onWirePreviewChange={handleWirePreviewChange}
            onPolicyDrop={(policy, position) =>
              dispatch({
                type: 'policyNodeAdded',
                policy,
                position,
              })}
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
            caseIndexMap={activeModal.caseIndexMap}
            onModeChange={(mode) => dispatch({ type: 'settingsModeChanged', mode })}
            onJsonChange={(value, caseIndexMap) =>
              dispatch({
                type: 'settingsJsonChanged',
                value,
                caseIndexMap,
              })}
            onApply={() => dispatch({ type: 'settingsApplied' })}
            onDelete={() => dispatch({ type: 'nodeDeleted', nodeId: settingsNode.id })}
            onClose={() => dispatch({ type: 'modalClosed' })}
          />
        )
        : null}
      {activeModal.type === 'playground'
        ? (
          <PlaygroundModal
            nodeId={activeModal.nodeId}
            direction={state.direction}
            message={playgroundMessage}
            connectionInfo={playgroundConnectionInfo}
            result={activeModal.result}
            error={activeModal.error}
            onMessageChange={setPlaygroundMessage}
            onConnectionInfoChange={setPlaygroundConnectionInfo}
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
