/** @jsxImportSource preact */
import { useReducer, useState } from 'preact/hooks';
import { pipelinesToGraph } from '../static/pipeline_graph.js';
import { fingerprintPipelines } from '../static/pipeline_workbench_state.js';
import { DEFAULT_PLUGINS } from './pipeline/defaults.ts';
import { Palette } from './pipeline/Palette.tsx';
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

export default function PipelineWorkbench() {
  const [state, dispatch] = useReducer(reduceWorkbench, createInitialState());
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const title = state.direction === 'client' ? 'Client Pipeline' : 'Server Pipeline';
  const workbenchClass = paletteCollapsed ? 'pipeline-workbench palette-collapsed' : 'pipeline-workbench';

  return (
    <div class={workbenchClass} id='pipeline-workbench'>
      <Toolbar
        direction={state.direction}
        onDirectionChange={(direction) => dispatch({ type: 'directionChanged', direction })}
        onRun={noop}
        onLoad={noop}
        onSave={noop}
        onPublish={noop}
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
          collapsed={paletteCollapsed}
          onToggle={() => setPaletteCollapsed((collapsed) => !collapsed)}
          onAdd={ignorePolicy}
        />
        <section class='canvas-shell canvas-shell-expanded'>
          <div class='canvas-toolbar'>
            <span id='canvas-title'>{title}</span>
            <span class='text-muted' id='canvas-zoom-label'>100%</span>
          </div>
          <div
            class='pipeline-canvas'
            id='pipeline-canvas'
            role='region'
            aria-label='Pipeline canvas'
          >
          </div>
        </section>
      </div>
    </div>
  );
}
