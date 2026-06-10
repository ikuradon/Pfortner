/** @jsxImportSource preact */
import { useReducer } from 'preact/hooks';
import { pipelinesToGraph } from '../static/pipeline_graph.js';
import { fingerprintPipelines } from '../static/pipeline_workbench_state.js';
import { Canvas } from './pipeline/Canvas.tsx';
import { DEFAULT_PLUGINS } from './pipeline/defaults.ts';
import { NodeSettingsModal } from './pipeline/NodeSettingsModal.tsx';
import { Palette } from './pipeline/Palette.tsx';
import { PlaygroundModal } from './pipeline/PlaygroundModal.tsx';
import { PublishModal } from './pipeline/PublishModal.tsx';
import { Toolbar } from './pipeline/Toolbar.tsx';
import { createInitialWorkbenchState, reduceWorkbench } from './pipeline/workbench_reducer.ts';

const EMPTY_PIPELINES = { client: [], server: [] };

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

function ignoreMessage(_message: string): void {
  return undefined;
}

export default function PipelineWorkbench() {
  const [state, dispatch] = useReducer(reduceWorkbench, createInitialState());
  const title = state.direction === 'client' ? 'Client Pipeline' : 'Server Pipeline';
  const workbenchClass = state.ui.paletteCollapsed ? 'pipeline-workbench palette-collapsed' : 'pipeline-workbench';
  const activeModal = state.ui.activeModal;
  const settingsNode = activeModal.type === 'settings'
    ? state.graphs[state.direction].nodes.find((node) => node.id === activeModal.nodeId)
    : undefined;

  return (
    <div class={workbenchClass} id='pipeline-workbench'>
      <Toolbar
        direction={state.direction}
        onDirectionChange={(direction) => dispatch({ type: 'directionChanged', direction })}
        onRun={noop}
        onLoad={noop}
        onSave={noop}
        onPublish={() => dispatch({ type: 'publishModalOpened' })}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
      />
      <span class='workbench-state-badges'>
        <span class='text-muted' id='workbench-status-summary'>
          {state.status.message}
        </span>
        <span class='badge badge-success' id='workbench-save-state'>
          Saved DAG
        </span>
        <span class='badge badge-success' id='workbench-publish-state'>
          Published
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
            onRun={ignoreMessage}
            onClose={() => dispatch({ type: 'modalClosed' })}
          />
        )
        : null}
      {activeModal.type === 'publish'
        ? (
          <PublishModal
            yaml={activeModal.yaml}
            onConfirm={() => dispatch({ type: 'publishConfirmed' })}
            onClose={() => dispatch({ type: 'modalClosed' })}
          />
        )
        : null}
    </div>
  );
}
