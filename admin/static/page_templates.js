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
    '/admin/playground': {
      title: 'Playground',
      render: renderPlaygroundPage,
      module: '/admin/static/playground.js',
      init: 'initPlaygroundPage',
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
    pageHeader('Pipelines', [
      button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh-pipelines' }),
      button('✓ Apply Config', 'btn btn-primary', { id: 'btn-apply-pipeline' }),
    ]),
    el('div', {
      id: 'pipeline-status',
      style: 'margin-bottom:12px;min-height:28px',
    }),
    el('div', { className: 'pipeline-tabs' }, [
      button('Client Pipeline', 'pipeline-tab active', {
        id: 'tab-client',
        dataset: { pipeline: 'client' },
      }),
      button('Server Pipeline', 'pipeline-tab', {
        id: 'tab-server',
        dataset: { pipeline: 'server' },
      }),
    ]),
    el('div', { className: 'pipelines-layout' }, [
      el('div', { className: 'pipeline-panel' }, [
        el('div', { className: 'pipeline-panel-header' }, [
          el('span', { id: 'tree-panel-title' }, [
            'Client Pipeline — Visual Tree',
          ]),
        ]),
        el('div', {
          className: 'pipeline-panel-body',
          id: 'pipeline-tree-container',
        }, [
          el('div', { className: 'pipeline-empty' }, ['Loading...']),
        ]),
        el('div', {
          className: 'add-policy-row',
          style: 'padding:12px 16px;border-top:1px solid var(--color-border)',
        }, [
          el('select', { id: 'add-policy-select', className: 'add-policy-select' }, [
            el('option', { value: '' }, ['— Select policy to add —']),
          ]),
          button('+ Add', 'btn btn-ghost', { id: 'btn-add-policy' }),
        ]),
        el('div', { className: 'pipeline-status', id: 'pipeline-tree-status' }),
      ]),
      el('div', { className: 'pipeline-panel' }, [
        el('div', { className: 'pipeline-panel-header' }, ['YAML Preview']),
        el('div', {
          className: 'pipeline-panel-body',
          style: 'padding:0;display:flex;flex-direction:column',
        }, [
          el('pre', { className: 'yaml-preview', id: 'yaml-preview' }, [
            'Loading...',
          ]),
        ]),
      ]),
    ]),
  );
}

export function renderPlaygroundPage(root) {
  root.replaceChildren(
    pageHeader(
      'Playground',
      [],
      el('span', { className: 'text-muted', style: 'font-size:13px' }, [
        'Test messages against the current pipeline',
      ]),
    ),
    el('div', { className: 'playground-layout' }, [
      el('div', { className: 'playground-panel' }, [
        el('div', { className: 'playground-panel-header' }, ['Message Input']),
        el('div', { className: 'playground-panel-body' }, [
          el('div', {}, [
            el('div', { className: 'section-title' }, ['Pipeline Direction']),
            el('div', { className: 'pipeline-direction-tabs' }, [
              button('Client', 'dir-tab active', {
                id: 'dir-client',
                dataset: { direction: 'client' },
              }),
              button('Server', 'dir-tab', {
                id: 'dir-server',
                dataset: { direction: 'server' },
              }),
            ]),
          ]),
          el('div', {}, [
            el('div', { className: 'section-title' }, ['Presets']),
            el('div', { className: 'preset-buttons', id: 'preset-buttons' }, [
              button('EVENT kind:1', 'preset-btn', {
                dataset: { preset: 'event-1' },
              }),
              button('EVENT kind:4 (DM)', 'preset-btn', {
                dataset: { preset: 'event-4' },
              }),
              button('EVENT kind:1059', 'preset-btn', {
                dataset: { preset: 'event-1059' },
              }),
              button('REQ basic', 'preset-btn', {
                dataset: { preset: 'req-basic' },
              }),
              button('REQ with search', 'preset-btn', {
                dataset: { preset: 'req-search' },
              }),
              button('CLOSE', 'preset-btn', {
                dataset: { preset: 'close' },
              }),
            ]),
          ]),
          el('div', { style: 'flex:1;display:flex;flex-direction:column' }, [
            el('div', { className: 'section-title' }, ['Message JSON']),
            el('textarea', {
              id: 'message-input',
              className: 'message-textarea',
              spellcheck: false,
              style: 'flex:1;min-height:120px',
              placeholder: '["EVENT", {...}]',
            }),
          ]),
          el('div', {}, [
            el('div', { className: 'section-title' }, ['Connection Context']),
            el('div', { className: 'context-grid' }, [
              el('label', {
                className: 'context-label',
                htmlFor: 'ctx-authenticated',
              }, ['Authenticated']),
              el('input', {
                type: 'checkbox',
                id: 'ctx-authenticated',
                style: 'width:auto',
              }),
              el('label', { className: 'context-label', htmlFor: 'ctx-pubkey' }, [
                'Pubkey',
              ]),
              el('input', {
                type: 'text',
                id: 'ctx-pubkey',
                className: 'context-input',
                placeholder: '(hex pubkey)',
              }),
              el('label', { className: 'context-label', htmlFor: 'ctx-ip' }, [
                'Client IP',
              ]),
              el('input', {
                type: 'text',
                id: 'ctx-ip',
                className: 'context-input',
                placeholder: '127.0.0.1',
                value: '127.0.0.1',
              }),
            ]),
          ]),
          button('▷ Run', 'btn btn-primary', {
            id: 'btn-run',
            style: 'width:100%',
          }),
        ]),
      ]),
      el('div', { className: 'playground-panel' }, [
        el('div', { className: 'playground-panel-header' }, [
          'Pipeline Execution Result',
        ]),
        el('div', { className: 'playground-panel-body', id: 'result-panel' }, [
          el('div', { className: 'playground-empty', id: 'result-empty' }, [
            'Enter a message and click Run to see results.',
          ]),
        ]),
      ]),
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
