/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';
import AdminIslandSmoke from '../islands/AdminIslandSmoke.tsx';

interface PipelinesPageProps {
  currentPath: string;
}

export function PipelinesPage({ currentPath }: PipelinesPageProps) {
  return (
    <Layout currentPath={currentPath} title='Pipelines'>
      <div class='pipeline-workbench' id='pipeline-workbench'>
        <div class='page-header'>
          <div class='pipeline-header-top'>
            <h1 class='page-title'>Pipelines</h1>
            <div class='pipeline-mode-tabs'>
              <button
                type='button'
                id='tab-client'
                class='btn btn-primary pipeline-mode-tab'
                data-pipeline='client'
              >
                Client
              </button>
              <button
                type='button'
                id='tab-server'
                class='btn btn-ghost pipeline-mode-tab'
                data-pipeline='server'
              >
                Server
              </button>
            </div>
          </div>
          <div class='pipeline-toolbar'>
            <button
              type='button'
              id='btn-undo-pipeline'
              class='btn btn-ghost'
              disabled
            >
              ↶ Undo
            </button>
            <button
              type='button'
              id='btn-redo-pipeline'
              class='btn btn-ghost'
              disabled
            >
              ↷ Redo
            </button>
            <button
              type='button'
              id='btn-run-pipeline'
              class='btn btn-ghost'
            >
              ▷ Run
            </button>
            <button
              type='button'
              id='btn-load-dag'
              class='btn btn-ghost'
            >
              Load
            </button>
            <button type='button' id='btn-fit-canvas' class='btn btn-ghost'>
              ⛶ Fit
            </button>
            <button
              type='button'
              id='btn-zoom-out'
              class='btn btn-ghost'
              title='Zoom out'
            >
              −
            </button>
            <button
              type='button'
              id='btn-zoom-in'
              class='btn btn-ghost'
              title='Zoom in'
            >
              +
            </button>
            <button type='button' id='btn-save-dag' class='btn btn-ghost'>
              Save
            </button>
            <button
              type='button'
              id='btn-publish-pipeline'
              class='btn btn-primary'
            >
              Publish
            </button>
          </div>
          <AdminIslandSmoke />
          <span class='workbench-state-badges'>
            <span class='text-muted' id='workbench-status-summary'>Ready</span>
            <span class='badge badge-success' id='workbench-save-state'>
              Saved DAG
            </span>
            <span class='badge badge-success' id='workbench-publish-state'>
              Published
            </span>
          </span>
        </div>

        <div id='pipeline-status' class='workbench-status'></div>

        <div class='workbench-grid canvas-first-grid' id='canvas-first-grid'>
          <aside class='workbench-panel palette-panel' id='palette-panel'>
            <div class='workbench-panel-header palette-header'>
              <span>Policy Palette</span>
              <button
                type='button'
                class='btn btn-ghost btn-icon'
                id='btn-toggle-palette'
                title='Collapse palette'
              >
                ‹
              </button>
            </div>
            <div
              class='workbench-panel-body policy-palette'
              id='policy-palette'
            >
              <div class='pipeline-empty'>Loading policies...</div>
            </div>
          </aside>

          <section class='canvas-shell canvas-shell-expanded'>
            <div class='canvas-toolbar'>
              <span id='canvas-title'>Client Pipeline</span>
              <span class='text-muted' id='canvas-zoom-label'>100%</span>
            </div>
            <div class='pipeline-canvas' id='pipeline-canvas' tabIndex={0}>
              <svg
                id='pipeline-svg'
                class='pipeline-svg'
                role='application'
                aria-label='Pipeline graph editor'
              >
              </svg>
              <div class='selection-marquee' id='selection-marquee'></div>
              <div class='canvas-minimap' id='canvas-minimap'>
                <svg id='minimap-svg' class='minimap-svg'></svg>
              </div>
            </div>
          </section>
        </div>

        <div class='modal-backdrop hidden' id='node-settings-modal'></div>
        <div class='modal-backdrop hidden' id='playground-modal'></div>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/pipelines.js' type='module'></script>
    </Layout>
  );
}
