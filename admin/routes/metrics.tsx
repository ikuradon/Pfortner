/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface MetricsPageProps {
  currentPath: string;
}

export function MetricsPage({ currentPath }: MetricsPageProps) {
  return (
    <Layout currentPath={currentPath} title='Metrics'>
      <div class='page-header'>
        <h1 class='page-title'>Metrics</h1>
        <div class='flex gap-2 items-center'>
          {/* Time range selector */}
          <div class='flex gap-2' id='time-range-selector'>
            <button type='button' class='btn btn-primary time-range-btn' data-range='5'>5m</button>
            <button type='button' class='btn btn-ghost time-range-btn' data-range='15'>15m</button>
            <button type='button' class='btn btn-ghost time-range-btn' data-range='60'>1h</button>
            <button type='button' class='btn btn-ghost time-range-btn' data-range='360'>6h</button>
            <button type='button' class='btn btn-ghost time-range-btn' data-range='1440'>24h</button>
          </div>
          <button type='button' id='btn-refresh-metrics' class='btn btn-ghost'>
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Throughput Chart */}
      <div class='chart-container' id='throughput-chart-section'>
        <div class='chart-title'>Throughput — Messages over Time</div>
        <div
          id='throughput-chart-body'
          style='min-height:120px;display:flex;align-items:center;justify-content:center;overflow-x:auto'
        >
          <span class='text-muted'>Loading...</span>
        </div>
      </div>

      {/* Policy Decisions Table */}
      <div class='chart-container'>
        <div class='chart-title'>Policy Decisions</div>
        <div id='policy-decisions-body'>
          <div style='text-align:center;padding:24px;color:var(--color-text-muted)'>
            Loading...
          </div>
        </div>
      </div>

      {/* Connection History Chart */}
      <div class='chart-container'>
        <div class='chart-title'>Connection Activity</div>
        <div
          id='connection-chart-body'
          style='min-height:100px;display:flex;align-items:center;justify-content:center;overflow-x:auto'
        >
          <span class='text-muted'>Loading...</span>
        </div>
      </div>

      {/* Raw Metrics Viewer */}
      <div class='chart-container' id='raw-metrics-section'>
        <div
          class='flex items-center'
          style='justify-content:space-between;margin-bottom:12px;cursor:pointer'
          id='raw-metrics-toggle'
        >
          <div class='chart-title' style='margin-bottom:0'>
            Raw Prometheus Metrics
          </div>
          <span id='raw-metrics-chevron' style='font-size:12px;color:var(--color-text-muted)'>
            ▶ Expand
          </span>
        </div>
        <div id='raw-metrics-content' style='display:none'>
          <div class='flex gap-2 items-center' style='margin-bottom:8px'>
            <input
              type='text'
              id='raw-metrics-search'
              class='form-input'
              placeholder='Filter lines...'
              style='flex:1;max-width:360px'
            />
            <button type='button' id='btn-copy-metrics' class='btn btn-ghost'>
              Copy
            </button>
          </div>
          <pre
            id='raw-metrics-pre'
            style='background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;padding:16px;font-size:12px;font-family:monospace;overflow:auto;max-height:400px;white-space:pre;color:var(--color-text)'
          >
            <span class='text-muted'>Loading...</span>
          </pre>
        </div>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/metrics.js' type='module'></script>
    </Layout>
  );
}
