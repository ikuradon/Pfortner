/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface ConfigPageProps {
  currentPath: string;
}

export function ConfigPage({ currentPath }: ConfigPageProps) {
  return (
    <Layout currentPath={currentPath} title='Config'>
      <div class='page-header'>
        <h1 class='page-title'>Config</h1>
        <div class='flex gap-2'>
          <button type='button' id='btn-refresh-config' class='btn btn-ghost'>
            ↺ Refresh
          </button>
          <button type='button' id='btn-reload-config' class='btn btn-primary'>
            ↻ Reload Config
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div id='config-status' style='margin-bottom:16px;min-height:28px'></div>

      {/* Config display */}
      <div class='chart-container'>
        <div class='chart-title'>Current Configuration (secrets masked)</div>
        <pre
          id='config-json'
          style='background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;padding:16px;overflow:auto;font-family:monospace;font-size:12px;line-height:1.6;max-height:600px;white-space:pre-wrap;word-break:break-all'
        >
          Loading…
        </pre>
      </div>

      <script src='/admin/static/config.js' type='module'></script>
    </Layout>
  );
}
