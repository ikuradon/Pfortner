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

      {/* Log level info */}
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

      {/* Log streaming notice */}
      <div class='chart-container'>
        <div class='chart-title'>Log Viewer</div>
        <div style='padding:32px;text-align:center;color:var(--color-text-muted);border:2px dashed var(--color-border);border-radius:8px'>
          <div style='font-size:32px;margin-bottom:12px'>≡</div>
          <div style='font-size:15px;font-weight:600;margin-bottom:8px'>
            Log Streaming Coming Soon
          </div>
          <div style='font-size:13px;max-width:480px;margin:0 auto'>
            Real-time log streaming via WebSocket or Server-Sent Events will be available in a future release. For now,
            view logs directly from your server process output or log aggregation system.
          </div>
        </div>
      </div>

      {/* Runtime info */}
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

      <script src='/admin/static/logs.js' type='module'></script>
    </Layout>
  );
}
