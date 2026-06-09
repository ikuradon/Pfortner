globalThis.__PFORTNER_SPA__ = true;

let currentCleanup = null;
let renderVersion = 0;
const assetVersion = new URL(import.meta.url).searchParams.get('v') ?? '';

export function versionStaticAssetPath(path, version = assetVersion) {
  if (!version) return path;
  const url = new URL(path, 'http://pfortner.local');
  url.searchParams.set('v', version);
  return url.pathname + url.search + url.hash;
}

const routes = {
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
  '/admin/blacklist': {
    title: 'Blacklist',
    render: renderBlacklistPage,
    module: '/admin/static/blacklist.js',
    init: 'initBlacklistPage',
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

function append(parent, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    child.forEach((item) => append(parent, item));
    return;
  }
  parent.appendChild(
    child instanceof Node ? child : document.createTextNode(String(child)),
  );
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'className' || key === 'class') {
      node.className = String(value);
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === 'attrs') {
      for (const [attrKey, attrValue] of Object.entries(value)) {
        if (attrValue !== null && attrValue !== undefined && attrValue !== false) {
          node.setAttribute(attrKey, String(attrValue));
        }
      }
    } else if (key === 'events') {
      for (const [eventName, handler] of Object.entries(value)) {
        node.addEventListener(eventName, handler);
      }
    } else if (key === 'style') {
      if (typeof value === 'string') {
        node.style.cssText = value;
      } else {
        Object.assign(node.style, value);
      }
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'htmlFor') {
      node.htmlFor = String(value);
    } else if (key === 'value') {
      node.value = String(value);
    } else if (key === 'checked') {
      node.checked = Boolean(value);
    } else if (key === 'disabled') {
      node.disabled = Boolean(value);
    } else if (key === 'selected') {
      node.selected = Boolean(value);
    } else if (key === 'colSpan') {
      node.colSpan = Number(value);
    } else if (key === 'spellcheck') {
      node.spellcheck = Boolean(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

function button(text, className, props = {}) {
  return el('button', { type: 'button', className, ...props }, [text]);
}

function pageHeader(title, actions = [], extra = null) {
  const children = [
    el('h1', { className: 'page-title' }, [title]),
  ];
  if (actions.length > 0) {
    children.push(el('div', { className: 'flex gap-2 items-center' }, actions));
  } else if (extra) {
    children.push(extra);
  }
  return el('div', { className: 'page-header' }, children);
}

function statCard(title, value, subtitle, valueId = null, valueStyle = null) {
  const valueProps = { className: 'card-value' };
  if (valueId) valueProps.id = valueId;
  if (valueStyle) valueProps.style = valueStyle;
  const children = [
    el('div', { className: 'card-title' }, [title]),
    el('div', valueProps, [value]),
  ];
  if (subtitle !== null && subtitle !== undefined) {
    children.push(el('div', { className: 'card-subtitle' }, [subtitle]));
  }
  return el('div', { className: 'card' }, children);
}

function loadingRow(colSpan, text = 'Loading...') {
  return el('tr', {}, [
    el('td', {
      colSpan,
      style: 'text-align:center;padding:24px;color:var(--color-text-muted)',
    }, [text]),
  ]);
}

function table(headers, tbodyId, loadingColSpan) {
  return el('table', { className: 'table' }, [
    el('thead', {}, [
      el(
        'tr',
        {},
        headers.map((header) => {
          const props = typeof header === 'string' ? {} : { style: header.style };
          return el('th', props, [typeof header === 'string' ? header : header.text]);
        }),
      ),
    ]),
    el('tbody', { id: tbodyId }, [loadingRow(loadingColSpan)]),
  ]);
}

function actionForm(action, text, className, confirmMessage = null) {
  return el('form', {
    method: 'POST',
    action,
    style: 'display:inline',
    events: confirmMessage
      ? {
        submit: (event) => {
          if (!confirm(confirmMessage)) event.preventDefault();
        },
      }
      : {},
  }, [
    el('button', { type: 'submit', className }, [text]),
  ]);
}

function chartContainer(children, props = {}) {
  return el('div', { className: 'chart-container', ...props }, children);
}

function loadingState(text = 'Loading...') {
  return el('span', { className: 'text-muted' }, [text]);
}

function renderDashboardPage(root) {
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

function renderConnectionsPage(root) {
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

function renderPipelinesPage(root) {
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

function renderPlaygroundPage(root) {
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

function renderMetricsPage(root) {
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

function renderBlacklistPage(root) {
  root.replaceChildren(
    pageHeader('Blacklist', [
      button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh' }),
    ]),
    chartContainer([
      el('div', { className: 'chart-title' }, ['IP Blacklist']),
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
      el('div', { className: 'chart-title' }, ['Pubkey Blacklist']),
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

function renderConfigPage(root) {
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

function renderLogsPage(root) {
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

function normalizePath(pathname) {
  if (pathname === '/admin') return '/admin/';
  return pathname.endsWith('/') && pathname !== '/admin/' ? pathname.slice(0, -1) : pathname;
}

function updateActiveNav(pathname) {
  const path = normalizePath(pathname);
  document.querySelectorAll('.sidebar-nav a').forEach((link) => {
    const href = normalizePath(link.getAttribute('href') || '');
    const active = href === path || (href !== '/admin/' && path.startsWith(href));
    link.classList.toggle('active', active);
  });
}

function renderError(root, message) {
  root.replaceChildren(
    el('div', { className: 'placeholder' }, [
      el('h2', {}, ['Unable to load page']),
      el('p', {}, [message]),
    ]),
  );
}

async function renderRoute(pathname) {
  const root = document.getElementById('admin-app');
  if (!root) return;

  const path = normalizePath(pathname);
  const route = routes[path];
  const version = ++renderVersion;

  if (typeof currentCleanup === 'function') {
    currentCleanup();
  }
  currentCleanup = null;

  if (!route) {
    document.title = 'Not Found - Pförtner Admin';
    updateActiveNav(path);
    renderError(root, 'Unknown admin page: ' + path);
    return;
  }

  document.title = route.title + ' - Pförtner Admin';
  updateActiveNav(path);
  route.render(root);

  try {
    const pageModule = await import(versionStaticAssetPath(route.module));
    if (version !== renderVersion) return;
    const init = pageModule[route.init];
    if (typeof init !== 'function') {
      throw new Error('Missing page initializer: ' + route.init);
    }
    const maybeCleanup = init();
    currentCleanup = typeof maybeCleanup === 'function' ? maybeCleanup : null;
  } catch (error) {
    if (version !== renderVersion) return;
    renderError(root, error instanceof Error ? error.message : String(error));
  }
}

function shouldHandleLink(event, link) {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target && link.target !== '_self') return false;

  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (!url.pathname.startsWith('/admin')) return false;
  if (
    url.pathname === '/admin/login' ||
    url.pathname === '/admin/logout' ||
    url.pathname.startsWith('/admin/static/')
  ) {
    return false;
  }
  return Boolean(routes[normalizePath(url.pathname)]);
}

function bindNavigation() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a');
    if (!link || !shouldHandleLink(event, link)) return;
    event.preventDefault();
    const url = new URL(link.href, window.location.href);
    const next = normalizePath(url.pathname);
    if (next !== normalizePath(window.location.pathname)) {
      history.pushState({}, '', next + url.search + url.hash);
    }
    renderRoute(next);
  });

  window.addEventListener('popstate', () => {
    renderRoute(window.location.pathname);
  });
}

function boot() {
  bindNavigation();
  renderRoute(window.location.pathname);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
