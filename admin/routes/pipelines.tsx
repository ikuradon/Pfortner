/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface PipelinesPageProps {
  currentPath: string;
}

export function PipelinesPage({ currentPath }: PipelinesPageProps) {
  return (
    <Layout currentPath={currentPath} title='Pipelines'>
      <style>
        {`
        .pipelines-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          height: calc(100vh - 120px);
        }
        .pipeline-panel {
          display: flex;
          flex-direction: column;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          overflow: hidden;
        }
        .pipeline-panel-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface-2);
          font-weight: 600;
          font-size: 13px;
        }
        .pipeline-panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .pipeline-tabs {
          display: flex;
          gap: 0;
          margin-bottom: 0;
        }
        .pipeline-tab {
          padding: 8px 20px;
          border: 1px solid var(--color-border);
          background: var(--color-surface-2);
          color: var(--color-text-muted);
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          border-right: none;
        }
        .pipeline-tab:last-child {
          border-right: 1px solid var(--color-border);
          border-radius: 0 6px 6px 0;
        }
        .pipeline-tab:first-child {
          border-radius: 6px 0 0 6px;
        }
        .pipeline-tab.active {
          background: var(--color-accent);
          color: #fff;
          border-color: var(--color-accent);
        }
        .pipeline-entry {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          margin-bottom: 8px;
          background: var(--color-surface);
          position: relative;
        }
        .pipeline-entry:hover {
          border-color: var(--color-accent);
        }
        .pipeline-entry-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: var(--color-surface-2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          flex-shrink: 0;
        }
        .pipeline-entry-info {
          flex: 1;
          min-width: 0;
        }
        .pipeline-entry-name {
          font-weight: 600;
          font-size: 13px;
          color: var(--color-text);
        }
        .pipeline-entry-config {
          font-size: 11px;
          color: var(--color-text-muted);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pipeline-entry-actions {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
        }
        .pipeline-entry-btn {
          padding: 3px 8px;
          font-size: 11px;
          border-radius: 4px;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
        }
        .pipeline-entry-btn:hover {
          background: var(--color-surface-2);
        }
        .pipeline-entry-btn.delete {
          color: var(--color-danger);
          border-color: var(--color-danger);
        }
        .pipeline-entry-btn.delete:hover {
          background: rgba(250,82,82,0.1);
        }
        .pipeline-children {
          margin-left: 28px;
          border-left: 2px solid var(--color-border);
          padding-left: 12px;
          margin-top: 6px;
        }
        .pipeline-children-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
          margin-top: 8px;
        }
        .add-policy-row {
          margin-top: 12px;
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .add-policy-select {
          flex: 1;
          padding: 7px 10px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-surface-2);
          color: var(--color-text);
          font-size: 13px;
        }
        .yaml-preview {
          font-family: monospace;
          font-size: 12px;
          line-height: 1.6;
          background: var(--color-surface-2);
          border: none;
          border-radius: 0;
          padding: 0;
          margin: 0;
          white-space: pre;
          overflow: auto;
          flex: 1;
          color: var(--color-text);
        }
        .pipeline-empty {
          text-align: center;
          padding: 32px;
          color: var(--color-text-muted);
          font-size: 13px;
        }
        .pipeline-status {
          padding: 8px 12px;
          font-size: 12px;
          min-height: 32px;
          border-top: 1px solid var(--color-border);
        }
        .config-editor-panel {
          margin-top: 8px;
          padding: 10px;
          background: var(--color-surface-2);
          border-radius: 6px;
          border: 1px solid var(--color-border);
        }
        .config-editor-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-muted);
          margin-bottom: 4px;
          display: block;
        }
        .config-editor-textarea {
          width: 100%;
          min-height: 80px;
          font-family: monospace;
          font-size: 12px;
          padding: 6px 8px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          background: var(--color-surface);
          color: var(--color-text);
          resize: vertical;
        }
        .move-btns {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .move-btn {
          padding: 1px 5px;
          font-size: 10px;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          border-radius: 3px;
          line-height: 1.4;
        }
        .move-btn:hover {
          background: var(--color-surface-2);
        }
      `}
      </style>

      <div class='page-header'>
        <h1 class='page-title'>Pipelines</h1>
        <div class='flex gap-2'>
          <button type='button' id='btn-refresh-pipelines' class='btn btn-ghost'>
            ↺ Refresh
          </button>
          <button type='button' id='btn-apply-pipeline' class='btn btn-primary'>
            ✓ Apply Config
          </button>
        </div>
      </div>

      <div id='pipeline-status' style='margin-bottom:12px;min-height:28px'></div>

      {/* Tab selector */}
      <div class='flex gap-0 mb-4' style='margin-bottom:16px'>
        <button type='button' class='pipeline-tab active' data-pipeline='client' id='tab-client'>
          Client Pipeline
        </button>
        <button type='button' class='pipeline-tab' data-pipeline='server' id='tab-server'>
          Server Pipeline
        </button>
      </div>

      <div class='pipelines-layout'>
        {/* Left: Visual Tree */}
        <div class='pipeline-panel'>
          <div class='pipeline-panel-header'>
            <span id='tree-panel-title'>Client Pipeline — Visual Tree</span>
          </div>
          <div class='pipeline-panel-body' id='pipeline-tree-container'>
            <div class='pipeline-empty'>Loading…</div>
          </div>
          <div class='add-policy-row' style='padding:12px 16px;border-top:1px solid var(--color-border)'>
            <select id='add-policy-select' class='add-policy-select'>
              <option value=''>— Select policy to add —</option>
            </select>
            <button type='button' id='btn-add-policy' class='btn btn-ghost'>
              + Add
            </button>
          </div>
          <div class='pipeline-status' id='pipeline-tree-status'></div>
        </div>

        {/* Right: YAML Preview */}
        <div class='pipeline-panel'>
          <div class='pipeline-panel-header'>YAML Preview</div>
          <div class='pipeline-panel-body' style='padding:0;display:flex;flex-direction:column'>
            <pre class='yaml-preview' id='yaml-preview'>Loading…</pre>
          </div>
        </div>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/pipelines.js' type='module'></script>
    </Layout>
  );
}
