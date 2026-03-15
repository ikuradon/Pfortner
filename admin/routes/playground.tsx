/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface PlaygroundPageProps {
  currentPath: string;
}

export function PlaygroundPage({ currentPath }: PlaygroundPageProps) {
  return (
    <Layout currentPath={currentPath} title='Playground'>
      <style>
        {`
        .playground-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          height: calc(100vh - 120px);
        }
        .playground-panel {
          display: flex;
          flex-direction: column;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          overflow: hidden;
        }
        .playground-panel-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface-2);
          font-weight: 600;
          font-size: 13px;
        }
        .playground-panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .preset-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .preset-btn {
          padding: 5px 10px;
          font-size: 12px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          background: var(--color-surface-2);
          color: var(--color-text);
          cursor: pointer;
          font-family: monospace;
        }
        .preset-btn:hover {
          border-color: var(--color-accent);
          color: var(--color-accent);
        }
        .message-textarea {
          width: 100%;
          min-height: 150px;
          font-family: monospace;
          font-size: 12px;
          padding: 10px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-surface-2);
          color: var(--color-text);
          resize: vertical;
          line-height: 1.5;
        }
        .message-textarea:focus {
          outline: none;
          border-color: var(--color-accent);
        }
        .context-grid {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 8px 12px;
          align-items: center;
        }
        .context-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-muted);
          white-space: nowrap;
        }
        .context-input {
          padding: 5px 8px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          background: var(--color-surface-2);
          color: var(--color-text);
          font-size: 12px;
          font-family: monospace;
          width: 100%;
        }
        .pipeline-direction-tabs {
          display: flex;
          gap: 0;
        }
        .dir-tab {
          padding: 6px 14px;
          border: 1px solid var(--color-border);
          background: var(--color-surface-2);
          color: var(--color-text-muted);
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
        }
        .dir-tab:first-child {
          border-radius: 4px 0 0 4px;
        }
        .dir-tab:last-child {
          border-radius: 0 4px 4px 0;
          border-left: none;
        }
        .dir-tab.active {
          background: var(--color-accent);
          color: #fff;
          border-color: var(--color-accent);
        }
        .step-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .step-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .step-line {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex-shrink: 0;
        }
        .step-circle {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          flex-shrink: 0;
          color: #fff;
        }
        .step-circle.accept {
          background: var(--color-success);
        }
        .step-circle.reject {
          background: var(--color-danger);
        }
        .step-circle.next {
          background: var(--color-text-muted);
        }
        .step-connector {
          width: 2px;
          flex: 1;
          min-height: 16px;
          background: var(--color-border);
          margin: 2px 0;
        }
        .step-content {
          flex: 1;
          padding-bottom: 4px;
        }
        .step-policy-name {
          font-weight: 600;
          font-size: 13px;
          color: var(--color-text);
        }
        .step-action-badge {
          display: inline-flex;
          align-items: center;
          padding: 1px 7px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 500;
          margin-left: 6px;
        }
        .step-action-badge.accept {
          background: rgba(64,192,87,0.15);
          color: var(--color-success);
        }
        .step-action-badge.reject {
          background: rgba(250,82,82,0.15);
          color: var(--color-danger);
        }
        .step-action-badge.next {
          background: var(--color-surface-2);
          color: var(--color-text-muted);
        }
        .step-detail {
          font-size: 11px;
          color: var(--color-text-muted);
          margin-top: 2px;
        }
        .step-response {
          font-size: 11px;
          color: var(--color-danger);
          margin-top: 2px;
          font-family: monospace;
        }
        .final-result {
          margin-top: 16px;
          padding: 16px;
          border-radius: 8px;
          text-align: center;
          font-weight: 700;
          font-size: 16px;
        }
        .final-result.accept {
          background: rgba(64,192,87,0.12);
          color: var(--color-success);
          border: 1px solid rgba(64,192,87,0.3);
        }
        .final-result.reject {
          background: rgba(250,82,82,0.12);
          color: var(--color-danger);
          border: 1px solid rgba(250,82,82,0.3);
        }
        .playground-empty {
          text-align: center;
          padding: 48px 24px;
          color: var(--color-text-muted);
          font-size: 13px;
        }
        .playground-error {
          padding: 12px;
          border-radius: 6px;
          background: rgba(250,82,82,0.1);
          color: var(--color-danger);
          font-size: 12px;
          border: 1px solid rgba(250,82,82,0.3);
        }
        .section-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }
      `}
      </style>

      <div class='page-header'>
        <h1 class='page-title'>Playground</h1>
        <span class='text-muted' style='font-size:13px'>Test messages against the current pipeline</span>
      </div>

      <div class='playground-layout'>
        {/* Left: Message Input */}
        <div class='playground-panel'>
          <div class='playground-panel-header'>Message Input</div>
          <div class='playground-panel-body'>
            {/* Pipeline direction */}
            <div>
              <div class='section-title'>Pipeline Direction</div>
              <div class='pipeline-direction-tabs'>
                <button type='button' class='dir-tab active' data-direction='client' id='dir-client'>
                  Client
                </button>
                <button type='button' class='dir-tab' data-direction='server' id='dir-server'>
                  Server
                </button>
              </div>
            </div>

            {/* Presets */}
            <div>
              <div class='section-title'>Presets</div>
              <div class='preset-buttons' id='preset-buttons'>
                <button type='button' class='preset-btn' data-preset='event-1'>EVENT kind:1</button>
                <button type='button' class='preset-btn' data-preset='event-4'>EVENT kind:4 (DM)</button>
                <button type='button' class='preset-btn' data-preset='event-1059'>EVENT kind:1059</button>
                <button type='button' class='preset-btn' data-preset='req-basic'>REQ basic</button>
                <button type='button' class='preset-btn' data-preset='req-search'>REQ with search</button>
                <button type='button' class='preset-btn' data-preset='close'>CLOSE</button>
              </div>
            </div>

            {/* Message JSON */}
            <div style='flex:1;display:flex;flex-direction:column'>
              <div class='section-title'>Message JSON</div>
              <textarea
                id='message-input'
                class='message-textarea'
                spellcheck={false}
                style='flex:1;min-height:120px'
                placeholder='["EVENT", {...}]'
              />
            </div>

            {/* Connection Context */}
            <div>
              <div class='section-title'>Connection Context</div>
              <div class='context-grid'>
                <label class='context-label' for='ctx-authenticated'>Authenticated</label>
                <input type='checkbox' id='ctx-authenticated' style='width:auto' />
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
            </div>

            {/* Run button */}
            <button type='button' id='btn-run' class='btn btn-primary' style='width:100%'>
              ▷ Run
            </button>
          </div>
        </div>

        {/* Right: Results */}
        <div class='playground-panel'>
          <div class='playground-panel-header'>Pipeline Execution Result</div>
          <div class='playground-panel-body' id='result-panel'>
            <div class='playground-empty' id='result-empty'>
              Enter a message and click Run to see results.
            </div>
          </div>
        </div>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/playground.js' type='module'></script>
    </Layout>
  );
}
