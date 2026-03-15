/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface DashboardPageProps {
  currentPath: string;
  health: {
    status: string;
    connections: { active: number; max: number; pressure: string };
    upstream: { status: string; latency_ms: number | null };
    uptime_seconds: number | null;
    memory: { rss: number; heapUsed: number } | null;
  };
}

function formatMemory(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function DashboardPage({ currentPath, health }: DashboardPageProps) {
  const statusBadge = health.status === 'ok'
    ? <span class='badge badge-success'>OK</span>
    : health.status === 'draining'
    ? <span class='badge badge-warning'>Draining</span>
    : <span class='badge badge-danger'>{health.status}</span>;

  const upstreamBadge = health.upstream.status === 'ok'
    ? <span class='badge badge-success'>Online</span>
    : <span class='badge badge-danger'>{health.upstream.status}</span>;

  const pressurePct = health.connections.max > 0
    ? Math.round((health.connections.active / health.connections.max) * 100)
    : 0;

  const pressureClass = pressurePct >= 90
    ? 'progress-bar-danger'
    : pressurePct >= 70
    ? 'progress-bar-warning'
    : 'progress-bar-success';

  return (
    <Layout currentPath={currentPath} title='Dashboard'>
      <div class='page-header'>
        <h1 class='page-title'>Dashboard</h1>
        <div class='flex gap-2'>
          <form method='POST' action='/admin/api/reload' style='display:inline'>
            <button type='submit' class='btn btn-ghost'>
              ↺ Reload Config
            </button>
          </form>
          <form
            method='POST'
            action='/admin/api/shutdown'
            style='display:inline'
            onSubmit={(e) => {
              if (!confirm('Initiate graceful shutdown?')) e.preventDefault();
            }}
          >
            <button type='submit' class='btn btn-danger'>
              ⏻ Shutdown
            </button>
          </form>
        </div>
      </div>

      {/* Stats Cards */}
      <div class='stats-grid' id='stats-cards'>
        <div class='card'>
          <div class='card-title'>Status</div>
          <div class='card-value'>{statusBadge}</div>
          <div class='card-subtitle'>
            Uptime: {health.uptime_seconds !== null ? `${health.uptime_seconds}s` : 'unknown'}
          </div>
        </div>
        <div class='card'>
          <div class='card-title'>Connections</div>
          <div class='card-value'>{health.connections.active}</div>
          <div class='card-subtitle'>Max: {health.connections.max}</div>
        </div>
        <div class='card'>
          <div class='card-title'>Upstream</div>
          <div class='card-value'>{upstreamBadge}</div>
          <div class='card-subtitle'>
            Latency: {health.upstream.latency_ms !== null ? `${health.upstream.latency_ms}ms` : 'N/A'}
          </div>
        </div>
        <div class='card'>
          <div class='card-title'>Memory (RSS)</div>
          <div class='card-value'>
            {health.memory ? formatMemory(health.memory.rss) : 'N/A'}
          </div>
          <div class='card-subtitle'>
            Heap: {health.memory ? formatMemory(health.memory.heapUsed) : 'N/A'}
          </div>
        </div>
      </div>

      {/* Pressure Bar */}
      <div class='chart-container'>
        <div class='chart-title'>
          Connection Pressure — {pressurePct}% ({health.connections.active}/{health.connections.max})
        </div>
        <div class='progress'>
          <div
            class={`progress-bar ${pressureClass}`}
            style={`width:${pressurePct}%`}
          />
        </div>
        <div class='mt-4' style='font-size:12px;color:var(--color-text-muted)'>
          Pressure level: <strong>{health.connections.pressure}</strong>
        </div>
      </div>

      {/* Throughput Chart placeholder — refreshed by client-side JS */}
      <div class='chart-container' id='throughput-chart'>
        <div class='chart-title'>Throughput (last 60s)</div>
        <div
          id='throughput-chart-body'
          style='min-height:80px;display:flex;align-items:center;justify-content:center'
        >
          <span class='text-muted'>Loading...</span>
        </div>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/dashboard.js' type='module'></script>
    </Layout>
  );
}
