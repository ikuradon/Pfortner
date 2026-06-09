/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface PipelinesPageProps {
  currentPath: string;
}

export function PipelinesPage({ currentPath }: PipelinesPageProps) {
  return (
    <Layout currentPath={currentPath} title='Pipelines'>
      <div class='pipeline-workbench' id='pipeline-workbench'>
        <div class='page-header'>
          <h1 class='page-title'>Pipelines</h1>
          <div class='flex gap-2 items-center'>
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
            <button
              type='button'
              id='btn-refresh-pipelines'
              class='btn btn-ghost'
            >
              ↺ Refresh
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
            <button type='button' id='btn-run-toolbar' class='btn btn-ghost'>
              ▷ Run
            </button>
            <button
              type='button'
              id='btn-apply-pipeline'
              class='btn btn-primary'
            >
              ↺ Reload Config
            </button>
          </div>
          <span class='text-muted' id='workbench-status-summary'>Ready</span>
        </div>

        <div id='pipeline-status' class='workbench-status'></div>

        <div class='workbench-grid'>
          <aside class='workbench-panel palette-panel'>
            <div class='workbench-panel-header'>Policy Palette</div>
            <div
              class='workbench-panel-body policy-palette'
              id='policy-palette'
            >
              <div class='pipeline-empty'>Loading policies...</div>
            </div>
          </aside>

          <section class='canvas-shell'>
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

          <aside class='workbench-panel inspector-panel'>
            <div class='workbench-panel-header'>Inspector</div>
            <div
              class='workbench-panel-body node-inspector'
              id='node-inspector'
            >
              <div class='pipeline-empty'>
                Select a node to edit its config.
              </div>
            </div>
          </aside>
        </div>

        <section class='test-run-drawer collapsed' id='test-run-drawer'>
          <button type='button' class='drawer-toggle' id='btn-toggle-test-run'>
            <span>Test Run</span>
            <span class='text-muted' id='test-run-summary'>No run yet</span>
          </button>
          <div class='drawer-content'>
            <div class='test-run-inputs'>
              <div>
                <div class='section-title'>Presets</div>
                <div class='preset-buttons' id='preset-buttons'></div>
              </div>
              <label class='section-title' for='message-input'>
                Message JSON
              </label>
              <textarea
                id='message-input'
                class='message-textarea'
                spellcheck={false}
                placeholder='["EVENT", {...}]'
              >
              </textarea>
              <div class='context-grid'>
                <label class='context-label' for='ctx-authenticated'>
                  Authenticated
                </label>
                <input type='checkbox' id='ctx-authenticated' />
                <label class='context-label' for='ctx-pubkey'>Pubkey</label>
                <input
                  type='text'
                  id='ctx-pubkey'
                  class='context-input'
                  placeholder='(hex pubkey)'
                />
                <label class='context-label' for='ctx-ip'>Client IP</label>
                <input
                  type='text'
                  id='ctx-ip'
                  class='context-input'
                  placeholder='127.0.0.1'
                  value='127.0.0.1'
                />
              </div>
              <button type='button' id='btn-run' class='btn btn-primary'>
                ▷ Run
              </button>
            </div>

            <div class='test-run-results'>
              <div class='workbench-panel-header'>Execution Result</div>
              <div class='playground-panel-body' id='result-panel'>
                <div class='playground-empty' id='result-empty'>
                  Enter a message and run it against the selected pipeline.
                </div>
              </div>
            </div>

            <div class='yaml-drawer-panel'>
              <div class='workbench-panel-header'>YAML Preview</div>
              <pre class='yaml-preview' id='yaml-preview'>Loading...</pre>
            </div>
          </div>
        </section>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/pipelines.js' type='module'></script>
    </Layout>
  );
}
