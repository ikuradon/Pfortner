/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface LogsPageProps {
  currentPath: string;
}

export function LogsPage({ currentPath }: LogsPageProps) {
  return (
    <Layout currentPath={currentPath} title='Logs'>
      <div class='page-header'>
        <h1 class='page-title'>Logs</h1>
        <button type='button' id='btn-refresh-logs' class='btn btn-ghost'>
          ↺ Refresh
        </button>
      </div>

      <div
        class='stats-grid'
        style='grid-template-columns:repeat(auto-fill,minmax(180px,1fr))'
      >
        <div class='card'>
          <div class='card-title'>Log Level</div>
          <div class='card-value' id='log-level-display' style='font-size:20px'>
            —
          </div>
          <div class='card-subtitle'>Current setting from config</div>
        </div>
      </div>

      <div class='chart-container'>
        <div class='log-title-row'>
          <div class='chart-title' style='margin-bottom:0'>Log Viewer</div>
          <span id='log-stream-status' class='log-status log-status-connecting'>connecting</span>
        </div>
        <div class='log-toolbar'>
          <button type='button' id='btn-pause-logs' class='btn btn-ghost'>
            Pause
          </button>
          <button type='button' id='btn-clear-logs' class='btn btn-ghost'>
            Clear
          </button>
          <span id='log-count-display' class='text-muted'>0 lines</span>
        </div>
        <div id='log-viewer' class='log-viewer' role='log' aria-live='polite'>
          <div id='log-empty-state' class='log-empty-state'>No logs loaded</div>
        </div>
      </div>

      <div class='chart-container'>
        <div class='chart-title'>Runtime Information</div>
        <table class='table'>
          <tbody id='runtime-info-tbody'>
            <tr>
              <td
                colspan={2}
                style='text-align:center;padding:24px;color:var(--color-text-muted)'
              >
                Loading…
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/logs.js' type='module'></script>
    </Layout>
  );
}
