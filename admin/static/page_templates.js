import {
  actionForm,
  button,
  chartContainer,
  el,
  loadingRow,
  loadingState,
  pageHeader,
  statCard,
  table,
} from './dom.js';

export function createPageRoutes() {
  return {
    '/admin/': {
      title: 'Dashboard',
      render: renderDashboardPage,
      module: '/admin/static/dashboard.js',
      init: 'initDashboardPage',
    },
    '/admin/connections': {
      title: 'Connections',
      render: renderConnectionsPage,
      module: '/admin/static/connections.js',
      init: 'initConnectionsPage',
    },
    '/admin/pipelines': {
      title: 'Pipelines',
      render: renderPipelinesPage,
      module: '/admin/static/pipelines.js',
      init: 'initPipelinesPage',
    },
    '/admin/metrics': {
      title: 'Metrics',
      render: renderMetricsPage,
      module: '/admin/static/metrics.js',
      init: 'initMetricsPage',
    },
    '/admin/blocklist': {
      title: 'Blocklist',
      render: renderBlocklistPage,
      module: '/admin/static/blocklist.js',
      init: 'initBlocklistPage',
    },
    '/admin/config': {
      title: 'Config',
      render: renderConfigPage,
      module: '/admin/static/config.js',
      init: 'initConfigPage',
    },
    '/admin/logs': {
      title: 'Logs',
      render: renderLogsPage,
      module: '/admin/static/logs.js',
      init: 'initLogsPage',
    },
  };
}

export function renderDashboardPage(root) {
  root.replaceChildren(
    pageHeader('Dashboard', [
      actionForm('/admin/api/reload', '↺ Reload Config', 'btn btn-ghost'),
      actionForm(
        '/admin/api/shutdown',
        '⏻ Shutdown',
        'btn btn-danger',
        'Initiate graceful shutdown?',
      ),
    ]),
    el('div', { className: 'stats-grid', id: 'stats-cards' }, [
      statCard('Status', '—', 'Uptime: unknown'),
      statCard('Connections', '—', 'Max: —'),
      statCard('Upstream', '—', 'Latency: N/A'),
      statCard('Memory (RSS)', '—', 'Heap: N/A'),
    ]),
    chartContainer([
      el('div', { className: 'chart-title' }, [
        'Connection Pressure — 0% (0/0)',
      ]),
      el('div', { className: 'progress' }, [
        el('div', {
          className: 'progress-bar progress-bar-success',
          style: 'width:0%',
        }),
      ]),
      el('div', {
        className: 'mt-4',
        style: 'font-size:12px;color:var(--color-text-muted)',
      }, ['Pressure level: ', el('strong', {}, ['normal'])]),
    ]),
    chartContainer([
      el('div', { className: 'chart-title' }, ['Throughput (last 60s)']),
      el('div', {
        id: 'throughput-chart-body',
        style: 'min-height:80px;display:flex;align-items:center;justify-content:center',
      }, [loadingState()]),
    ], { id: 'throughput-chart' }),
  );
}

export function renderConnectionsPage(root) {
  root.replaceChildren(
    pageHeader('Connections', [
      button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh' }),
      button('✕ Disconnect Selected', 'btn btn-danger', {
        id: 'btn-disconnect-selected',
        disabled: true,
      }),
    ]),
    el('div', { className: 'stats-grid', id: 'conn-summary' }, [
      statCard('Total', '—', null, 'summary-total'),
      statCard('Authenticated', '—', null, 'summary-authed'),
      statCard('Unauthenticated', '—', null, 'summary-unauthed'),
    ]),
    el('div', { className: 'card', style: 'margin-bottom:16px' }, [
      el('div', {
        className: 'flex gap-2 items-center',
        style: 'flex-wrap:wrap',
      }, [
        el('input', {
          type: 'text',
          id: 'search-input',
          className: 'form-input',
          placeholder: 'Filter by IP or pubkey...',
          style: 'flex:1;min-width:200px;max-width:360px',
        }),
        el('div', { className: 'flex gap-2' }, [
          button('All', 'btn btn-primary auth-filter-btn', {
            dataset: { filter: 'all' },
          }),
          button('Authenticated', 'btn btn-ghost auth-filter-btn', {
            dataset: { filter: 'authenticated' },
          }),
          button('Unauthenticated', 'btn btn-ghost auth-filter-btn', {
            dataset: { filter: 'unauthenticated' },
          }),
        ]),
      ]),
    ]),
    chartContainer([
      el('table', { className: 'table', id: 'connections-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { style: 'width:40px' }, [
              el('input', {
                type: 'checkbox',
                id: 'select-all',
                title: 'Select all',
              }),
            ]),
            el('th', {}, ['ID']),
            el('th', {}, ['Client IP']),
            el('th', {}, ['Pubkey']),
            el('th', {}, ['Auth']),
            el('th', {}, ['Connected']),
            el('th', { style: 'width:100px' }, ['Action']),
          ]),
        ]),
        el('tbody', { id: 'connections-tbody' }, [loadingRow(7)]),
      ]),
    ], { style: 'padding:0;overflow:hidden' }),
  );
}

export function renderPipelinesPage(root) {
  root.replaceChildren(
    el('div', { className: 'pipeline-workbench', id: 'pipeline-workbench' }, [
      el('div', { className: 'page-header' }, [
        el('h1', { className: 'page-title' }, ['Pipelines']),
        el('div', { className: 'flex gap-2 items-center' }, [
          button('Client', 'btn btn-primary pipeline-mode-tab', {
            id: 'tab-client',
            dataset: { pipeline: 'client' },
          }),
          button('Server', 'btn btn-ghost pipeline-mode-tab', {
            id: 'tab-server',
            dataset: { pipeline: 'server' },
          }),
          button('↶ Undo', 'btn btn-ghost', {
            id: 'btn-undo-pipeline',
            disabled: true,
          }),
          button('↷ Redo', 'btn btn-ghost', {
            id: 'btn-redo-pipeline',
            disabled: true,
          }),
          button('▷ Run', 'btn btn-ghost', { id: 'btn-run-pipeline' }),
          button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh-pipelines' }),
          button('⛶ Fit', 'btn btn-ghost', { id: 'btn-fit-canvas' }),
          button('−', 'btn btn-ghost', {
            id: 'btn-zoom-out',
            title: 'Zoom out',
          }),
          button('+', 'btn btn-ghost', { id: 'btn-zoom-in', title: 'Zoom in' }),
          button('Save DAG', 'btn btn-ghost', { id: 'btn-save-dag' }),
          button('Publish', 'btn btn-primary', { id: 'btn-publish-pipeline' }),
        ]),
        el(
          'span',
          { className: 'workbench-state-badges' },
          [
            el('span', { className: 'text-muted', id: 'workbench-status-summary' }, [
              'Ready',
            ]),
            el('span', { className: 'badge badge-success', id: 'workbench-save-state' }, [
              'Saved DAG',
            ]),
            el('span', { className: 'badge badge-success', id: 'workbench-publish-state' }, [
              'Published',
            ]),
          ],
        ),
      ]),
      el('div', { id: 'pipeline-status', className: 'workbench-status' }),
      el('div', {
        className: 'workbench-grid canvas-first-grid',
        id: 'canvas-first-grid',
      }, [
        el('aside', {
          className: 'workbench-panel palette-panel',
          id: 'palette-panel',
        }, [
          el('div', { className: 'workbench-panel-header palette-header' }, [
            el('span', {}, ['Policy Palette']),
            button('‹', 'btn btn-ghost btn-icon', {
              id: 'btn-toggle-palette',
              title: 'Collapse palette',
            }),
          ]),
          el('div', {
            className: 'workbench-panel-body policy-palette',
            id: 'policy-palette',
          }, [
            el('div', { className: 'pipeline-empty' }, ['Loading policies...']),
          ]),
        ]),
        el('section', { className: 'canvas-shell canvas-shell-expanded' }, [
          el('div', { className: 'canvas-toolbar' }, [
            el('span', { id: 'canvas-title' }, ['Client Pipeline']),
            el('span', { className: 'text-muted', id: 'canvas-zoom-label' }, [
              '100%',
            ]),
          ]),
          el('div', {
            className: 'pipeline-canvas',
            id: 'pipeline-canvas',
            tabindex: '0',
          }, [
            el('svg', {
              id: 'pipeline-svg',
              className: 'pipeline-svg',
              attrs: {
                role: 'application',
                'aria-label': 'Pipeline graph editor',
              },
            }),
            el('div', {
              className: 'selection-marquee',
              id: 'selection-marquee',
            }),
            el('div', { className: 'canvas-minimap', id: 'canvas-minimap' }, [
              el('svg', { id: 'minimap-svg', className: 'minimap-svg' }),
            ]),
          ]),
        ]),
      ]),
      el('div', { className: 'modal-backdrop hidden', id: 'node-settings-modal' }),
      el('div', { className: 'modal-backdrop hidden', id: 'playground-modal' }),
    ]),
  );
}

export function renderMetricsPage(root) {
  root.replaceChildren(
    pageHeader('Metrics', [
      el('div', { className: 'flex gap-2', id: 'time-range-selector' }, [
        button('5m', 'btn btn-primary time-range-btn', { dataset: { range: '5' } }),
        button('15m', 'btn btn-ghost time-range-btn', { dataset: { range: '15' } }),
        button('1h', 'btn btn-ghost time-range-btn', { dataset: { range: '60' } }),
        button('6h', 'btn btn-ghost time-range-btn', { dataset: { range: '360' } }),
        button('24h', 'btn btn-ghost time-range-btn', {
          dataset: { range: '1440' },
        }),
      ]),
      button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh-metrics' }),
    ]),
    chartContainer([
      el('div', { className: 'chart-title' }, ['Throughput — Messages over Time']),
      el('div', {
        id: 'throughput-chart-body',
        style: 'min-height:120px;display:flex;align-items:center;justify-content:center;overflow-x:auto',
      }, [loadingState()]),
    ], { id: 'throughput-chart-section' }),
    chartContainer([
      el('div', { className: 'chart-title' }, ['Policy Decisions']),
      el('div', { id: 'policy-decisions-body' }, [
        el('div', {
          style: 'text-align:center;padding:24px;color:var(--color-text-muted)',
        }, ['Loading...']),
      ]),
    ]),
    chartContainer([
      el('div', { className: 'chart-title' }, ['Connection Activity']),
      el('div', {
        id: 'connection-chart-body',
        style: 'min-height:100px;display:flex;align-items:center;justify-content:center;overflow-x:auto',
      }, [loadingState()]),
    ]),
    chartContainer([
      el('div', {
        className: 'flex items-center',
        id: 'raw-metrics-toggle',
        style: 'justify-content:space-between;margin-bottom:12px;cursor:pointer',
      }, [
        el('div', { className: 'chart-title', style: 'margin-bottom:0' }, [
          'Raw Prometheus Metrics',
        ]),
        el('span', {
          id: 'raw-metrics-chevron',
          style: 'font-size:12px;color:var(--color-text-muted)',
        }, ['▶ Expand']),
      ]),
      el('div', { id: 'raw-metrics-content', style: 'display:none' }, [
        el('div', {
          className: 'flex gap-2 items-center',
          style: 'margin-bottom:8px',
        }, [
          el('input', {
            type: 'text',
            id: 'raw-metrics-search',
            className: 'form-input',
            placeholder: 'Filter lines...',
            style: 'flex:1;max-width:360px',
          }),
          button('Copy', 'btn btn-ghost', { id: 'btn-copy-metrics' }),
        ]),
        el('pre', {
          id: 'raw-metrics-pre',
          style:
            'background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;padding:16px;font-size:12px;font-family:monospace;overflow:auto;max-height:400px;white-space:pre;color:var(--color-text)',
        }, [loadingState()]),
      ]),
    ], { id: 'raw-metrics-section' }),
  );
}

export function renderBlocklistPage(root) {
  root.replaceChildren(
    pageHeader('Blocklist', [
      button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh' }),
    ]),
    chartContainer([
      el('div', { className: 'chart-title' }, ['IP Blocklist']),
      el('div', {
        className: 'flex gap-2 mb-4',
        style: 'align-items:flex-end',
      }, [
        el('div', {
          className: 'form-group',
          style: 'margin:0;flex:1;max-width:360px',
        }, [
          el('label', { className: 'form-label', htmlFor: 'ip-input' }, [
            'IP Address',
          ]),
          el('input', {
            type: 'text',
            id: 'ip-input',
            className: 'form-input',
            placeholder: 'e.g. 192.168.1.100',
          }),
        ]),
        button('+ Add', 'btn btn-primary', { id: 'btn-add-ip' }),
      ]),
      el('div', { id: 'ip-list-container' }, [
        table(
          [
            'IP Address',
            { text: 'Action', style: 'width:100px' },
          ],
          'ip-tbody',
          2,
        ),
      ]),
    ], { style: 'margin-bottom:24px' }),
    chartContainer([
      el('div', { className: 'chart-title' }, ['Pubkey Blocklist']),
      el('div', {
        className: 'flex gap-2 mb-4',
        style: 'align-items:flex-end',
      }, [
        el('div', {
          className: 'form-group',
          style: 'margin:0;flex:1;max-width:480px',
        }, [
          el('label', { className: 'form-label', htmlFor: 'pubkey-input' }, [
            'Pubkey (hex)',
          ]),
          el('input', {
            type: 'text',
            id: 'pubkey-input',
            className: 'form-input',
            placeholder: '64-char hex pubkey...',
          }),
        ]),
        button('+ Add', 'btn btn-primary', { id: 'btn-add-pubkey' }),
      ]),
      el('div', { id: 'pubkey-list-container' }, [
        table(
          [
            'Pubkey',
            { text: 'Action', style: 'width:100px' },
          ],
          'pubkey-tbody',
          2,
        ),
      ]),
    ]),
  );
}

export function renderConfigPage(root) {
  root.replaceChildren(
    pageHeader('Config', [
      button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh-config' }),
      button('↻ Reload Config', 'btn btn-primary', { id: 'btn-reload-config' }),
    ]),
    el('div', {
      id: 'config-status',
      style: 'margin-bottom:16px;min-height:28px',
    }),
    chartContainer([
      el('div', { className: 'chart-title' }, [
        'Current Configuration (secrets masked)',
      ]),
      el('pre', {
        id: 'config-json',
        style:
          'background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;padding:16px;overflow:auto;font-family:monospace;font-size:12px;line-height:1.6;max-height:600px;white-space:pre-wrap;word-break:break-all',
      }, ['Loading...']),
    ]),
  );
}

export function renderLogsPage(root) {
  root.replaceChildren(
    pageHeader('Logs', [
      button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh-logs' }),
    ]),
    el('div', {
      className: 'stats-grid',
      style: 'grid-template-columns:repeat(auto-fill,minmax(180px,1fr))',
    }, [
      statCard(
        'Log Level',
        '—',
        'Current setting from config',
        'log-level-display',
        'font-size:20px',
      ),
    ]),
    chartContainer([
      el('div', { className: 'log-title-row' }, [
        el('div', { className: 'chart-title', style: 'margin-bottom:0' }, [
          'Log Viewer',
        ]),
        el('span', {
          id: 'log-stream-status',
          className: 'log-status log-status-connecting',
        }, ['connecting']),
      ]),
      el('div', { className: 'log-toolbar' }, [
        button('Pause', 'btn btn-ghost', { id: 'btn-pause-logs' }),
        button('Clear', 'btn btn-ghost', { id: 'btn-clear-logs' }),
        el('span', { id: 'log-count-display', className: 'text-muted' }, [
          '0 lines',
        ]),
      ]),
      el('div', {
        id: 'log-viewer',
        className: 'log-viewer',
        role: 'log',
        attrs: { 'aria-live': 'polite' },
      }, [
        el('div', { id: 'log-empty-state', className: 'log-empty-state' }, [
          'No logs loaded',
        ]),
      ]),
    ]),
    chartContainer([
      el('div', { className: 'chart-title' }, ['Runtime Information']),
      el('table', { className: 'table' }, [
        el('tbody', { id: 'runtime-info-tbody' }, [loadingRow(2)]),
      ]),
    ]),
  );
}
