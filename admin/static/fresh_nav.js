// Lightweight Fresh-compatible partial navigation for the programmatic admin app.

const DASHBOARD_POLL_INTERVAL_MS = 5000;
const CONNECTIONS_POLL_INTERVAL_MS = 10000;
const METRICS_POLL_INTERVAL_MS = 10000;
const MAX_METRICS_TRACKER_MINUTES = 5;
const MAX_VISIBLE_LOGS = 500;

const ADMIN_ISLAND_MODULES = {
  '/admin/static/islands/AdminIslandSmoke.js': () => import('./islands/AdminIslandSmoke.js'),
  '/admin/static/islands/PipelineWorkbench.js': () => import('./islands/PipelineWorkbench.js'),
};

function browserGlobal() {
  return globalThis.window ?? globalThis;
}

let booted = false;
let navigating = false;
let dashboardPoller = null;
let connectionsPoller = null;
let allConnections = [];
let connectionsAuthFilter = 'all';
let connectionsSearchText = '';
let metricsPoller = null;
let metricsSelectedRange = 5;
let rawMetricsText = '';
let rawMetricsExpanded = false;
let logStream = null;
let logsPaused = false;
const seenLogIds = new Set();

function mountThemeToggle() {
  const mount = document.getElementById('theme-toggle-mount');
  if (!mount || mount.querySelector('.theme-toggle')) return;

  const button = document.createElement('button');
  button.className = 'theme-toggle';
  button.title = 'Toggle dark/light theme';
  button.setAttribute('aria-label', 'Toggle theme');

  function getCurrentTheme() {
    return document.documentElement?.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function updateButton(theme) {
    button.textContent = theme === 'dark' ? '☀' : '☽';
  }

  updateButton(getCurrentTheme());
  button.addEventListener('click', () => {
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement?.setAttribute('data-theme', next);
    try {
      localStorage.setItem('pfortner-theme', next);
    } catch {
      // Ignore storage failures; the current page theme still updates.
    }
    updateButton(next);
  });
  mount.appendChild(button);
}

function mountLayoutBehaviors() {
  mountThemeToggle();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function bindOnce(element, key, listener, type = 'click') {
  const attribute = `data-pfortner-${key}-${type}-bound`;
  if (element.getAttribute(attribute) === 'true') return;
  element.setAttribute(attribute, 'true');
  element.addEventListener(type, listener);
}

function clearElementChildren(element) {
  while (element?.firstChild) element.removeChild(element.firstChild);
}

function formatUptime(seconds) {
  if (seconds === null || seconds === undefined) return 'unknown';
  const total = Number(seconds);
  if (!Number.isFinite(total)) return 'unknown';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function fetchJsonOrNull(url, options) {
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function createPagePoller({ intervalMs, run, runImmediately = true }) {
  let timer = null;
  let running = false;

  async function refresh() {
    if (running) return;
    running = true;
    try {
      await run();
    } finally {
      running = false;
    }
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    stop();
    if (runImmediately) refresh();
    timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh();
    }, intervalMs);
  }

  return { refresh, start, stop };
}

function setElementText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

function renderTableState(tbody, colSpan, message, kind) {
  if (!tbody) return;
  clearElementChildren(tbody);
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = colSpan;
  cell.style.textAlign = 'center';
  cell.style.padding = '32px';
  cell.style.color = kind === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)';
  cell.textContent = message;
  row.appendChild(cell);
  tbody.appendChild(row);
}

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stopDashboardPoller() {
  dashboardPoller?.stop();
  dashboardPoller = null;
}

function formatDashboardMb(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function makeDashboardBadge(cssClass, text) {
  const span = document.createElement('span');
  span.className = cssClass;
  span.textContent = text;
  return span;
}

function makeDashboardCard(title, valueNode, subtitle) {
  const card = document.createElement('div');
  card.className = 'card';

  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const valueEl = document.createElement('div');
  valueEl.className = 'card-value';
  if (typeof valueNode === 'string') {
    valueEl.textContent = valueNode;
  } else {
    valueEl.appendChild(valueNode);
  }
  card.appendChild(valueEl);

  const subtitleEl = document.createElement('div');
  subtitleEl.className = 'card-subtitle';
  subtitleEl.textContent = subtitle;
  card.appendChild(subtitleEl);

  return card;
}

function updateDashboardStats(data) {
  const cards = document.getElementById('stats-cards');
  if (!cards) return;

  const statusBadge = data.status === 'ok'
    ? makeDashboardBadge('badge badge-success', 'OK')
    : data.status === 'draining'
    ? makeDashboardBadge('badge badge-warning', 'Draining')
    : makeDashboardBadge('badge badge-danger', String(data.status));

  const upstreamBadge = data.upstream?.status === 'ok'
    ? makeDashboardBadge('badge badge-success', 'Online')
    : makeDashboardBadge('badge badge-danger', String(data.upstream?.status ?? 'unknown'));

  const active = data.connections?.active ?? 0;
  const max = data.connections?.max ?? 0;
  const pressure = data.connections?.pressure ?? 'normal';
  const latency = data.upstream?.latency_ms !== null && data.upstream?.latency_ms !== undefined
    ? `${data.upstream.latency_ms}ms`
    : 'N/A';
  const rss = data.memory?.rss ? formatDashboardMb(data.memory.rss) : 'N/A';
  const heap = data.memory?.heapUsed ? formatDashboardMb(data.memory.heapUsed) : 'N/A';

  clearElementChildren(cards);
  cards.appendChild(makeDashboardCard('Status', statusBadge, `Uptime: ${formatUptime(data.uptime_seconds)}`));
  cards.appendChild(makeDashboardCard('Connections', String(active), `Max: ${max}`));
  cards.appendChild(makeDashboardCard('Upstream', upstreamBadge, `Latency: ${latency}`));
  cards.appendChild(makeDashboardCard('Memory (RSS)', rss, `Heap: ${heap}`));

  const pct = max > 0 ? Math.round((active / max) * 100) : 0;
  const pressureClass = pct >= 90 ? 'progress-bar-danger' : pct >= 70 ? 'progress-bar-warning' : 'progress-bar-success';
  const container = document.querySelector('.chart-container');
  if (!container) return;

  const titleEl = container.querySelector('.chart-title');
  if (titleEl) titleEl.textContent = `Connection Pressure — ${pct}% (${active}/${max})`;

  const bar = container.querySelector('.progress-bar');
  if (bar) {
    bar.className = `progress-bar ${pressureClass}`;
    bar.style.width = `${pct}%`;
  }

  const pressureText = container.querySelector('strong');
  if (pressureText) pressureText.textContent = pressure;
}

function renderDashboardThroughputChart(data) {
  const container = document.getElementById('throughput-chart-body');
  if (!container) return;

  clearElementChildren(container);

  if (!Array.isArray(data) || data.length === 0) {
    const message = document.createElement('span');
    message.className = 'text-muted';
    message.textContent = 'No throughput data available';
    container.appendChild(message);
    return;
  }

  const maxVal = Math.max(
    ...data.map((entry) => Math.max(entry.accept || 0, entry.reject || 0)),
    1,
  );
  const barWidth = 8;
  const barGap = 2;
  const chartHeight = 80;
  const totalWidth = data.length * (barWidth * 2 + barGap + 2);
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(totalWidth));
  svg.setAttribute('height', String(chartHeight));
  svg.setAttribute('style', 'display:block;overflow:visible');

  data.forEach((entry, index) => {
    const x = index * (barWidth * 2 + barGap + 2);
    const acceptHeight = Math.round(((entry.accept || 0) / maxVal) * chartHeight);
    const rejectHeight = Math.round(((entry.reject || 0) / maxVal) * chartHeight);

    if (acceptHeight > 0) {
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(chartHeight - acceptHeight));
      rect.setAttribute('width', String(barWidth));
      rect.setAttribute('height', String(acceptHeight));
      rect.setAttribute('fill', 'var(--color-accent)');
      rect.setAttribute('opacity', '0.8');
      svg.appendChild(rect);
    }

    if (rejectHeight > 0) {
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', String(x + barWidth + 1));
      rect.setAttribute('y', String(chartHeight - rejectHeight));
      rect.setAttribute('width', String(barWidth));
      rect.setAttribute('height', String(rejectHeight));
      rect.setAttribute('fill', 'var(--color-danger)');
      rect.setAttribute('opacity', '0.8');
      svg.appendChild(rect);
    }
  });

  const wrapper = document.createElement('div');
  const scrollDiv = document.createElement('div');
  scrollDiv.style.cssText = 'overflow-x:auto';
  scrollDiv.appendChild(svg);
  wrapper.appendChild(scrollDiv);

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--color-text-muted)';

  const acceptItem = document.createElement('span');
  acceptItem.style.cssText = 'display:flex;align-items:center;gap:4px';
  const acceptSwatch = document.createElement('span');
  acceptSwatch.style.cssText =
    'width:10px;height:10px;background:var(--color-accent);display:inline-block;border-radius:2px';
  acceptItem.appendChild(acceptSwatch);
  acceptItem.appendChild(document.createTextNode('Accept'));
  legend.appendChild(acceptItem);

  const rejectItem = document.createElement('span');
  rejectItem.style.cssText = 'display:flex;align-items:center;gap:4px';
  const rejectSwatch = document.createElement('span');
  rejectSwatch.style.cssText =
    'width:10px;height:10px;background:var(--color-danger);display:inline-block;border-radius:2px';
  rejectItem.appendChild(rejectSwatch);
  rejectItem.appendChild(document.createTextNode('Reject'));
  legend.appendChild(rejectItem);

  wrapper.appendChild(legend);
  container.appendChild(wrapper);
}

async function pollDashboardStats() {
  const data = await fetchJsonOrNull('/admin/api/health/detail');
  if (data) updateDashboardStats(data);
}

async function pollDashboardThroughput() {
  const data = await fetchJsonOrNull('/admin/api/metrics/throughput');
  if (data) renderDashboardThroughputChart(data);
}

async function pollDashboard() {
  await Promise.all([pollDashboardStats(), pollDashboardThroughput()]);
}

function initializeDashboardPage() {
  const hasDashboard = document.getElementById('stats-cards') &&
    document.getElementById('throughput-chart-body');
  if (!hasDashboard) {
    stopDashboardPoller();
    return;
  }

  stopDashboardPoller();
  dashboardPoller = createPagePoller({
    intervalMs: DASHBOARD_POLL_INTERVAL_MS,
    run: pollDashboard,
  });
  dashboardPoller.start();
}

function stopConnectionsPoller() {
  connectionsPoller?.stop();
  connectionsPoller = null;
}

function normalizeConnection(raw) {
  const id = raw?.id ?? raw?.connectionId ?? '';
  const ip = raw?.ip ?? raw?.remoteAddr ?? raw?.connectionIpAddr ?? '';
  const pubkey = raw?.pubkey ?? raw?.clientPubkey ?? '';
  const authenticated = Boolean(raw?.authenticated ?? raw?.clientAuthorized ?? pubkey);
  const connectedAt = raw?.connectedAt ?? raw?.connected_at ?? null;
  return {
    id: String(id),
    ip: String(ip),
    authenticated,
    pubkey: String(pubkey),
    connectedAt: connectedAt == null ? null : String(connectedAt),
  };
}

function shortConnectionId(id) {
  if (!id) return '—';
  return id.slice(0, 8);
}

function shortPubkey(pubkey) {
  if (!pubkey) return '—';
  return `${pubkey.slice(0, 8)}\u2026`;
}

function updateConnectionsSummary(connections) {
  const total = connections.length;
  const authed = connections.filter((connection) => connection.authenticated || connection.pubkey).length;
  const unauthed = total - authed;

  setElementText('summary-total', total);
  setElementText('summary-authed', authed);
  setElementText('summary-unauthed', unauthed);
}

function filterConnections(connections) {
  return connections.filter((connection) => {
    const isAuthed = Boolean(connection.authenticated || connection.pubkey);
    if (connectionsAuthFilter === 'authenticated' && !isAuthed) return false;
    if (connectionsAuthFilter === 'unauthenticated' && isAuthed) return false;

    if (connectionsSearchText) {
      const query = connectionsSearchText.toLowerCase();
      const ip = connection.ip.toLowerCase();
      const pubkey = connection.pubkey.toLowerCase();
      if (!ip.includes(query) && !pubkey.includes(query)) return false;
    }
    return true;
  });
}

function makeConnectionAuthBadge(isAuthed) {
  const span = document.createElement('span');
  span.className = isAuthed ? 'badge badge-success' : 'badge badge-danger';
  span.textContent = isAuthed ? 'Auth' : 'No Auth';
  return span;
}

function makeConnectionDisconnectButton(id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-danger btn-disconnect';
  button.dataset.id = id;
  button.style.padding = '4px 10px';
  button.style.fontSize = '12px';
  button.textContent = 'Disconnect';
  button.addEventListener('click', () => {
    disconnectConnectionsBatch([id]);
  });
  return button;
}

function makeConnectionRow(connection) {
  const id = connection.id;
  const ip = connection.ip || '—';
  const pubkey = connection.pubkey;
  const isAuthed = Boolean(connection.authenticated || pubkey);

  const row = document.createElement('tr');
  row.dataset.id = id;

  const checkCell = document.createElement('td');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'row-check';
  checkbox.dataset.id = id;
  checkbox.addEventListener('change', updateConnectionsBulkButton);
  checkCell.appendChild(checkbox);
  row.appendChild(checkCell);

  const idCell = document.createElement('td');
  const idSpan = document.createElement('span');
  idSpan.title = id;
  idSpan.style.fontFamily = 'monospace';
  idSpan.style.fontSize = '12px';
  idSpan.textContent = shortConnectionId(id);
  idCell.appendChild(idSpan);
  row.appendChild(idCell);

  const ipCell = document.createElement('td');
  ipCell.style.fontFamily = 'monospace';
  ipCell.style.fontSize = '12px';
  ipCell.textContent = ip;
  row.appendChild(ipCell);

  const pubkeyCell = document.createElement('td');
  pubkeyCell.style.fontFamily = 'monospace';
  pubkeyCell.style.fontSize = '12px';
  if (pubkey) {
    const pubkeySpan = document.createElement('span');
    pubkeySpan.title = pubkey;
    pubkeySpan.textContent = shortPubkey(pubkey);
    pubkeyCell.appendChild(pubkeySpan);
  } else {
    pubkeyCell.textContent = '—';
  }
  row.appendChild(pubkeyCell);

  const authCell = document.createElement('td');
  authCell.appendChild(makeConnectionAuthBadge(isAuthed));
  row.appendChild(authCell);

  const timeCell = document.createElement('td');
  timeCell.style.fontSize = '12px';
  timeCell.style.color = 'var(--color-text-muted)';
  timeCell.textContent = formatRelativeTime(connection.connectedAt);
  row.appendChild(timeCell);

  const actionCell = document.createElement('td');
  actionCell.appendChild(makeConnectionDisconnectButton(id));
  row.appendChild(actionCell);

  return row;
}

function renderConnectionsTable(connections) {
  const tbody = document.getElementById('connections-tbody');
  if (!tbody) return;

  clearElementChildren(tbody);

  if (connections.length === 0) {
    renderTableState(tbody, 7, 'No connections', 'empty');
    return;
  }

  for (const connection of connections) {
    tbody.appendChild(makeConnectionRow(connection));
  }
}

function getCheckedConnectionIds() {
  return [...document.querySelectorAll('.row-check')]
    .filter((element) => element.checked)
    .map((element) => element.dataset.id);
}

function updateConnectionsBulkButton() {
  const button = document.getElementById('btn-disconnect-selected');
  if (!button) return;
  button.disabled = getCheckedConnectionIds().length === 0;
}

async function disconnectConnectionsBatch(ids) {
  if (!ids || ids.length === 0) return;
  if (!confirm(`Disconnect ${ids.length} connection(s)?`)) return;

  try {
    const response = await fetch('/admin/api/connections/disconnect-batch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    await fetchConnectionsForPage();
  } catch (error) {
    alert(`Error: ${getErrorMessage(error)}`);
  }
}

function applyConnectionFiltersAndRender() {
  renderConnectionsTable(filterConnections(allConnections));
  updateConnectionsBulkButton();
}

async function fetchConnectionsForPage() {
  try {
    const response = await fetch('/admin/api/connections', {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    allConnections = Array.isArray(data.connections) ? data.connections.map(normalizeConnection) : [];
    updateConnectionsSummary(allConnections);
    applyConnectionFiltersAndRender();
  } catch (error) {
    const tbody = document.getElementById('connections-tbody');
    renderTableState(tbody, 7, `Error loading connections: ${getErrorMessage(error)}`, 'error');
  }
}

function initializeConnectionsPage() {
  if (!document.getElementById('connections-tbody')) {
    stopConnectionsPoller();
    return;
  }

  stopConnectionsPoller();
  allConnections = [];
  connectionsAuthFilter = 'all';
  connectionsSearchText = '';
  connectionsPoller = createPagePoller({
    intervalMs: CONNECTIONS_POLL_INTERVAL_MS,
    run: fetchConnectionsForPage,
  });
  connectionsPoller.start();
  const activePoller = connectionsPoller;

  const refreshButton = document.getElementById('btn-refresh');
  if (refreshButton) {
    bindOnce(refreshButton, 'connections-refresh', () => {
      activePoller.refresh();
    });
  }

  const bulkButton = document.getElementById('btn-disconnect-selected');
  if (bulkButton) {
    bindOnce(bulkButton, 'connections-bulk-disconnect', () => {
      disconnectConnectionsBatch(getCheckedConnectionIds());
    });
  }

  const selectAll = document.getElementById('select-all');
  if (selectAll) {
    bindOnce(selectAll, 'connections-select-all', (event) => {
      document.querySelectorAll('.row-check').forEach((checkbox) => {
        checkbox.checked = event.target.checked;
      });
      updateConnectionsBulkButton();
    }, 'change');
  }

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    bindOnce(searchInput, 'connections-search', (event) => {
      connectionsSearchText = event.target.value.trim();
      applyConnectionFiltersAndRender();
    }, 'input');
  }

  document.querySelectorAll('.auth-filter-btn').forEach((button) => {
    bindOnce(button, 'connections-auth-filter', (event) => {
      connectionsAuthFilter = event.currentTarget.dataset.filter || 'all';
      document.querySelectorAll('.auth-filter-btn').forEach((filterButton) => {
        filterButton.className = filterButton.dataset.filter === connectionsAuthFilter
          ? 'btn btn-primary auth-filter-btn'
          : 'btn btn-ghost auth-filter-btn';
      });
      applyConnectionFiltersAndRender();
    });
  });
}

function stopMetricsPoller() {
  metricsPoller?.stop();
  metricsPoller = null;
}

function buildMetricsSvgChart(data, options) {
  const {
    height = 100,
    barW = 8,
    barGap = 2,
    valueKeys,
    colors,
    labels,
  } = options;

  if (!Array.isArray(data) || data.length === 0) {
    const noData = document.createElement('span');
    noData.className = 'text-muted';
    noData.textContent = 'No data available';
    return noData;
  }

  const maxVal = Math.max(
    ...data.map((entry) => valueKeys.reduce((sum, key) => sum + (entry[key] || 0), 0)),
    1,
  );
  const barGroupWidth = barW * valueKeys.length + barGap * (valueKeys.length - 1);
  const groupGap = 3;
  const totalWidth = data.length * (barGroupWidth + groupGap);
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(totalWidth));
  svg.setAttribute('height', String(height));
  svg.setAttribute('style', 'display:block;overflow:visible');

  const labelStep = Math.max(1, Math.floor(data.length / 10));
  for (let index = 0; index < data.length; index += labelStep) {
    const entry = data[index];
    if (!entry.ts) continue;
    const x = index * (barGroupWidth + groupGap) + barGroupWidth / 2;
    const text = document.createElementNS(svgNs, 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(height + 14));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', 'var(--color-text-muted)');
    const date = new Date(entry.ts);
    text.textContent = `${date.getHours().toString().padStart(2, '0')}:${
      date.getMinutes().toString().padStart(2, '0')
    }`;
    svg.appendChild(text);
  }

  data.forEach((entry, index) => {
    const groupX = index * (barGroupWidth + groupGap);
    valueKeys.forEach((key, keyIndex) => {
      const value = entry[key] || 0;
      const barHeight = Math.round((value / maxVal) * height);
      if (barHeight === 0) return;

      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', String(groupX + keyIndex * (barW + barGap)));
      rect.setAttribute('y', String(height - barHeight));
      rect.setAttribute('width', String(barW));
      rect.setAttribute('height', String(barHeight));
      rect.setAttribute('fill', colors[keyIndex]);
      rect.setAttribute('opacity', '0.85');
      rect.setAttribute('rx', '2');

      const title = document.createElementNS(svgNs, 'title');
      title.textContent = `${labels[keyIndex] || key}: ${value}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
  });

  const wrapper = document.createElement('div');
  const scrollDiv = document.createElement('div');
  scrollDiv.style.cssText = 'overflow-x:auto;padding-bottom:20px';
  scrollDiv.appendChild(svg);
  wrapper.appendChild(scrollDiv);

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:16px;margin-top:4px;font-size:11px;color:var(--color-text-muted)';
  valueKeys.forEach((key, keyIndex) => {
    const item = document.createElement('span');
    item.style.cssText = 'display:flex;align-items:center;gap:4px';
    const swatch = document.createElement('span');
    swatch.style.cssText = `width:10px;height:10px;display:inline-block;border-radius:2px;background:${
      colors[keyIndex]
    }`;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(labels[keyIndex] || key));
    legend.appendChild(item);
  });
  wrapper.appendChild(legend);

  return wrapper;
}

function renderMetricsThroughputChart(buckets) {
  const container = document.getElementById('throughput-chart-body');
  if (!container) return;

  const cutoff = Date.now() - metricsSelectedRange * 60 * 1000;
  const filtered = buckets.filter((bucket) => bucket.ts >= cutoff);
  const insufficient = metricsSelectedRange > MAX_METRICS_TRACKER_MINUTES && filtered.length === 0;

  if (insufficient || buckets.length === 0) {
    clearElementChildren(container);
    const message = document.createElement('span');
    message.className = 'text-muted';
    message.textContent = metricsSelectedRange > MAX_METRICS_TRACKER_MINUTES
      ? 'Insufficient data \u2014 only ~5 minutes of history is available'
      : 'No throughput data available';
    container.appendChild(message);
    return;
  }

  const chart = buildMetricsSvgChart(filtered.length > 0 ? filtered : buckets, {
    height: 100,
    barW: 8,
    barGap: 2,
    valueKeys: ['accept', 'reject'],
    colors: ['var(--color-accent)', 'var(--color-danger)'],
    labels: ['Accept', 'Reject'],
  });
  clearElementChildren(container);
  container.appendChild(chart);
}

function renderMetricsConnectionChart(buckets) {
  const container = document.getElementById('connection-chart-body');
  if (!container) return;

  const cutoff = Date.now() - metricsSelectedRange * 60 * 1000;
  const filtered = buckets.filter((bucket) => bucket.ts >= cutoff);
  const data = (filtered.length > 0 ? filtered : buckets).map((bucket) => ({
    ts: bucket.ts,
    total: (bucket.accept || 0) + (bucket.reject || 0),
  }));

  if (data.length === 0) {
    clearElementChildren(container);
    const message = document.createElement('span');
    message.className = 'text-muted';
    message.textContent = 'No activity data available';
    container.appendChild(message);
    return;
  }

  const chart = buildMetricsSvgChart(data, {
    height: 80,
    barW: 10,
    barGap: 0,
    valueKeys: ['total'],
    colors: ['var(--color-success)'],
    labels: ['Messages'],
  });
  clearElementChildren(container);
  container.appendChild(chart);
}

function parsePrometheusPolicyMetrics(text) {
  const decisions = {};
  const metricLine = /^pfortner_policy_decisions_total\{([^}]+)\}\s+(\d+(?:\.\d+)?)$/;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = metricLine.exec(trimmed);
    if (!match) continue;

    const labels = {};
    for (const part of match[1].split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      labels[part.slice(0, eq).trim()] = part.slice(eq + 1).replace(/^"|"$/g, '').trim();
    }

    const policy = labels.policy || '(unknown)';
    const action = labels.action || '(unknown)';
    if (!decisions[policy]) decisions[policy] = { accept: 0, reject: 0, next: 0, other: 0 };
    const key = action === 'accept' || action === 'reject' || action === 'next' ? action : 'other';
    decisions[policy][key] += parseInt(match[2], 10);
  }

  return decisions;
}

function renderMetricsPolicyTable(text) {
  const container = document.getElementById('policy-decisions-body');
  if (!container) return;

  const policies = Object.entries(parsePrometheusPolicyMetrics(text));
  clearElementChildren(container);

  if (policies.length === 0) {
    const message = document.createElement('div');
    message.style.cssText = 'text-align:center;padding:24px;color:var(--color-text-muted)';
    message.textContent = 'No policy decision data available';
    container.appendChild(message);
    return;
  }

  policies.sort((a, b) => {
    const totalA = a[1].accept + a[1].reject + a[1].next + a[1].other;
    const totalB = b[1].accept + b[1].reject + b[1].next + b[1].other;
    return totalB - totalA;
  });

  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const column of ['Policy', 'Accept', 'Reject', 'Next', 'Total']) {
    const th = document.createElement('th');
    th.textContent = column;
    if (column !== 'Policy') th.style.textAlign = 'right';
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const [policyName, counts] of policies) {
    const total = counts.accept + counts.reject + counts.next + counts.other;
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.style.cssText = 'font-family:monospace;font-size:12px';
    nameCell.textContent = policyName;
    row.appendChild(nameCell);

    const acceptCell = document.createElement('td');
    acceptCell.style.cssText = 'text-align:right;color:var(--color-success)';
    acceptCell.textContent = String(counts.accept);
    row.appendChild(acceptCell);

    const rejectCell = document.createElement('td');
    rejectCell.style.cssText = 'text-align:right;color:var(--color-danger)';
    rejectCell.textContent = String(counts.reject);
    row.appendChild(rejectCell);

    const nextCell = document.createElement('td');
    nextCell.style.cssText = 'text-align:right;color:var(--color-text-muted)';
    nextCell.textContent = String(counts.next);
    row.appendChild(nextCell);

    const totalCell = document.createElement('td');
    totalCell.style.cssText = 'text-align:right;font-weight:600';
    totalCell.textContent = String(total);
    row.appendChild(totalCell);

    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function applyRawMetricsFilter() {
  const searchInput = document.getElementById('raw-metrics-search');
  const pre = document.getElementById('raw-metrics-pre');
  if (!pre) return;

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  if (!query) {
    pre.textContent = rawMetricsText || '# No metrics data';
    return;
  }

  const filtered = rawMetricsText
    .split('\n')
    .filter((line) => line.toLowerCase().includes(query))
    .join('\n');
  pre.textContent = filtered || '# No matching lines';
}

function updateRawMetrics(text) {
  rawMetricsText = text;
  applyRawMetricsFilter();
}

async function fetchMetricsThroughputForPage() {
  try {
    const response = await fetch('/admin/api/metrics/throughput', {
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const data = await response.json();
    const buckets = Array.isArray(data) ? data : [];
    renderMetricsThroughputChart(buckets);
    renderMetricsConnectionChart(buckets);
  } catch {
    // Ignore polling errors; the next refresh can recover the page.
  }
}

async function fetchPrometheusMetricsForPage() {
  try {
    const response = await fetch('/admin/api/metrics/prometheus', {
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const text = await response.text();
    updateRawMetrics(text);
    renderMetricsPolicyTable(text);
  } catch {
    // Ignore polling errors; the next refresh can recover the page.
  }
}

async function refreshMetricsPage() {
  await Promise.all([
    fetchMetricsThroughputForPage(),
    fetchPrometheusMetricsForPage(),
  ]);
}

function initializeMetricsPage() {
  if (!document.getElementById('throughput-chart-body') || !document.getElementById('policy-decisions-body')) {
    stopMetricsPoller();
    return;
  }

  stopMetricsPoller();
  metricsSelectedRange = 5;
  rawMetricsText = '';
  rawMetricsExpanded = false;

  document.querySelectorAll('.time-range-btn').forEach((button) => {
    bindOnce(button, 'metrics-range', (event) => {
      const range = parseInt(event.currentTarget.dataset.range || '5', 10);
      metricsSelectedRange = range;
      document.querySelectorAll('.time-range-btn').forEach((rangeButton) => {
        rangeButton.className = parseInt(rangeButton.dataset.range || '5', 10) === range
          ? 'btn btn-primary time-range-btn'
          : 'btn btn-ghost time-range-btn';
      });
      fetchMetricsThroughputForPage();
    });
  });

  const toggle = document.getElementById('raw-metrics-toggle');
  const content = document.getElementById('raw-metrics-content');
  const chevron = document.getElementById('raw-metrics-chevron');
  if (toggle && content && chevron) {
    bindOnce(toggle, 'metrics-raw-toggle', () => {
      rawMetricsExpanded = !rawMetricsExpanded;
      content.style.display = rawMetricsExpanded ? 'block' : 'none';
      chevron.textContent = rawMetricsExpanded ? '\u25bc Collapse' : '\u25b6 Expand';
    });
  }

  const searchInput = document.getElementById('raw-metrics-search');
  if (searchInput) {
    bindOnce(searchInput, 'metrics-raw-search', applyRawMetricsFilter, 'input');
  }

  const copyButton = document.getElementById('btn-copy-metrics');
  if (copyButton) {
    bindOnce(copyButton, 'metrics-copy', async () => {
      try {
        await navigator.clipboard.writeText(rawMetricsText);
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      } catch {
        const pre = document.getElementById('raw-metrics-pre');
        if (!pre || typeof document.createRange !== 'function') return;
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = globalThis.getSelection?.();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });
  }

  metricsPoller = createPagePoller({
    intervalMs: METRICS_POLL_INTERVAL_MS,
    run: refreshMetricsPage,
  });
  metricsPoller.start();
  const activePoller = metricsPoller;

  const refreshButton = document.getElementById('btn-refresh-metrics');
  if (refreshButton) {
    bindOnce(refreshButton, 'metrics-refresh', () => {
      activePoller.refresh();
    });
  }
}

function makeLogInfoRow(label, value) {
  const row = document.createElement('tr');

  const labelCell = document.createElement('td');
  labelCell.style.fontWeight = '600';
  labelCell.style.color = 'var(--color-text-muted)';
  labelCell.style.width = '200px';
  labelCell.textContent = label;
  row.appendChild(labelCell);

  const valueCell = document.createElement('td');
  valueCell.style.fontFamily = 'monospace';
  valueCell.textContent = value;
  row.appendChild(valueCell);

  return row;
}

function getLogRows() {
  const viewer = document.getElementById('log-viewer');
  return Array.from(viewer?.querySelectorAll('.log-row') ?? []);
}

function updateLogCount() {
  const rows = getLogRows();
  const count = document.getElementById('log-count-display');
  if (count) count.textContent = `${rows.length}${rows.length === 1 ? ' line' : ' lines'}`;

  const empty = document.getElementById('log-empty-state');
  if (empty) empty.style.display = rows.length === 0 ? 'block' : 'none';
}

function setLogStreamStatus(state, label) {
  const status = document.getElementById('log-stream-status');
  if (!status) return;

  const effectiveState = logsPaused && state === 'streaming' ? 'paused' : state;
  const effectiveLabel = logsPaused && state === 'streaming' ? 'paused' : label;
  status.textContent = effectiveLabel;
  status.className = `log-status log-status-${effectiveState}`;
}

function formatLogTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function normalizeLogLevel(level) {
  const normalized = String(level || 'log').toLowerCase();
  return normalized === 'debug' || normalized === 'info' ||
      normalized === 'warn' || normalized === 'error'
    ? normalized
    : 'log';
}

function parseLogLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const level = normalizeLogLevel(parsed.level);
      const timestamp = typeof parsed.timestamp === 'string'
        ? parsed.timestamp
        : typeof parsed.time === 'string'
        ? parsed.time
        : '';
      const message = typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.msg === 'string'
        ? parsed.msg
        : line;
      const details = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (
          key !== 'timestamp' && key !== 'time' && key !== 'level' &&
          key !== 'message' && key !== 'msg'
        ) {
          details[key] = value;
        }
      }
      return {
        details: Object.keys(details).length > 0 ? JSON.stringify(details) : '',
        level,
        message,
        timestamp,
      };
    }
  } catch {
    // Treat invalid JSON as a plain text log line.
  }

  const match = line.match(/^(\S+)\s+(DEBUG|INFO|WARN|ERROR)\s+(.*)$/);
  if (match) {
    return {
      details: '',
      level: normalizeLogLevel(match[2]),
      message: match[3],
      timestamp: match[1],
    };
  }

  return { details: '', level: 'log', message: line, timestamp: '' };
}

function pruneLogRows() {
  const rows = getLogRows();
  while (rows.length > MAX_VISIBLE_LOGS) {
    const row = rows.shift();
    if (!row) break;
    const id = Number(row.dataset.logId);
    if (Number.isFinite(id)) seenLogIds.delete(id);
    row.remove();
  }
}

function appendLogEntry(entry, options = {}) {
  if (!entry || typeof entry.line !== 'string') return;
  if (logsPaused && !options.force) return;

  const id = Number(entry.id);
  if (Number.isFinite(id)) {
    if (seenLogIds.has(id)) return;
    seenLogIds.add(id);
  }

  const viewer = document.getElementById('log-viewer');
  if (!viewer) return;

  const wasAtBottom = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 24;
  const parsed = parseLogLine(entry.line);
  const level = normalizeLogLevel(parsed.level);

  const row = document.createElement('div');
  row.className = `log-row log-row-${level}`;
  row.title = entry.line;
  if (Number.isFinite(id)) row.dataset.logId = String(id);

  const time = document.createElement('span');
  time.className = 'log-row-time';
  time.textContent = formatLogTimestamp(parsed.timestamp || entry.received_at);
  row.appendChild(time);

  const levelElement = document.createElement('span');
  levelElement.className = 'log-row-level';
  levelElement.textContent = level.toUpperCase();
  row.appendChild(levelElement);

  const message = document.createElement('span');
  message.className = 'log-row-message';
  message.textContent = parsed.details ? `${parsed.message} ${parsed.details}` : parsed.message;
  row.appendChild(message);

  viewer.appendChild(row);
  pruneLogRows();
  updateLogCount();

  if (wasAtBottom || options.force) {
    viewer.scrollTop = viewer.scrollHeight;
  }
}

function clearRenderedLogs() {
  for (const row of getLogRows()) row.remove();
  seenLogIds.clear();
  updateLogCount();
}

async function fetchLogsInfoForPage() {
  const [configData, healthData] = await Promise.all([
    fetchJsonOrNull('/admin/api/config'),
    fetchJsonOrNull('/admin/api/health/detail'),
  ]);
  if (typeof document === 'undefined') return;

  const logLevel = configData?.infra?.metrics?.logging?.level ||
    configData?.log?.level ||
    configData?.logging?.level ||
    configData?.log_level ||
    '—';

  const logLevelElement = document.getElementById('log-level-display');
  if (logLevelElement) logLevelElement.textContent = String(logLevel);

  const uptime = healthData?.uptime_seconds != null ? formatUptime(healthData.uptime_seconds) : '—';
  const connections = healthData?.connections?.active != null ? String(healthData.connections.active) : '—';
  const status = healthData?.status || '—';
  const streamStatus = document.getElementById('log-stream-status')?.textContent || '—';

  const tbody = document.getElementById('runtime-info-tbody');
  if (!tbody) return;

  clearElementChildren(tbody);
  tbody.appendChild(makeLogInfoRow('Log Level', String(logLevel)));
  tbody.appendChild(makeLogInfoRow('Server Status', status));
  tbody.appendChild(makeLogInfoRow('Uptime', uptime));
  tbody.appendChild(makeLogInfoRow('Active Connections', connections));
  tbody.appendChild(makeLogInfoRow('Log Streaming', streamStatus));
  tbody.appendChild(makeLogInfoRow('Timestamp', new Date().toLocaleString()));
}

async function fetchLogsForPage() {
  const data = await fetchJsonOrNull('/admin/api/logs?limit=200');
  if (typeof document === 'undefined') return;
  if (!data || !Array.isArray(data.logs)) {
    if (!logStream) setLogStreamStatus('fallback', 'fallback unavailable');
    return;
  }

  clearRenderedLogs();
  for (const entry of data.logs) appendLogEntry(entry, { force: true });

  if (!logStream) setLogStreamStatus('fallback', 'fallback');
}

function createLogEventStream(options) {
  let source = null;
  const eventName = options.eventName ?? 'message';

  function setStatus(state, label) {
    options.onStatus?.(state, label);
  }

  function close() {
    if (source) {
      source.close();
      source = null;
    }
  }

  function connect() {
    const EventSourceCtor = browserGlobal().EventSource;
    if (typeof EventSourceCtor !== 'function') {
      setStatus('fallback', 'fallback');
      options.fallback?.();
      return;
    }

    close();
    setStatus('connecting', 'connecting');
    source = new EventSourceCtor(options.url);
    source.onopen = () => setStatus('streaming', 'streaming');
    source.addEventListener(eventName, options.onEvent);
    source.addEventListener('heartbeat', (event) => {
      options.onHeartbeat?.(event);
      setStatus('streaming', 'streaming');
    });
    source.onerror = () => {
      setStatus('disconnected', 'disconnected');
      options.fallback?.();
    };
  }

  return {
    close,
    connect,
    isClosed: () =>
      !source || typeof browserGlobal().EventSource !== 'function' ||
      source.readyState === browserGlobal().EventSource.CLOSED,
  };
}

function connectLogsStream() {
  logStream?.close();
  logStream = createLogEventStream({
    url: '/admin/api/logs/stream?replay=100',
    eventName: 'log',
    onStatus(state, label) {
      setLogStreamStatus(state, label);
      if (state === 'streaming') fetchLogsInfoForPage();
    },
    onEvent(event) {
      try {
        appendLogEntry(JSON.parse(event.data));
        if (!logsPaused) setLogStreamStatus('streaming', 'streaming');
      } catch {
        setLogStreamStatus('disconnected', 'invalid stream event');
      }
    },
    fallback() {
      fetchLogsForPage();
      fetchLogsInfoForPage();
    },
  });
  logStream.connect();
}

function stopLogsStream() {
  logStream?.close();
  logStream = null;
}

function toggleLogsPause() {
  logsPaused = !logsPaused;

  const pauseButton = document.getElementById('btn-pause-logs');
  if (pauseButton) pauseButton.textContent = logsPaused ? 'Resume' : 'Pause';

  if (logsPaused) {
    setLogStreamStatus('paused', 'paused');
  } else {
    setLogStreamStatus(logStream ? 'streaming' : 'connecting', logStream ? 'streaming' : 'connecting');
    fetchLogsForPage();
  }

  fetchLogsInfoForPage();
}

function initializeLogsPage() {
  if (!document.getElementById('log-viewer') || !document.getElementById('runtime-info-tbody')) {
    stopLogsStream();
    return;
  }

  stopLogsStream();
  logsPaused = false;
  seenLogIds.clear();

  updateLogCount();
  fetchLogsInfoForPage();
  fetchLogsForPage();
  connectLogsStream();

  const refreshButton = document.getElementById('btn-refresh-logs');
  if (refreshButton) {
    bindOnce(refreshButton, 'logs-refresh', () => {
      fetchLogsInfoForPage();
      fetchLogsForPage();
      if (!logStream || logStream.isClosed()) connectLogsStream();
    });
  }

  const pauseButton = document.getElementById('btn-pause-logs');
  if (pauseButton) bindOnce(pauseButton, 'logs-pause', toggleLogsPause);

  const clearButton = document.getElementById('btn-clear-logs');
  if (clearButton) bindOnce(clearButton, 'logs-clear', clearRenderedLogs);
}

function showConfigStatus(message, isError) {
  const element = document.getElementById('config-status');
  if (!element) return;

  while (element.firstChild) element.removeChild(element.firstChild);

  const badge = document.createElement('span');
  badge.className = `badge ${isError ? 'badge-danger' : 'badge-success'}`;
  badge.style.fontSize = '13px';
  badge.style.padding = '4px 12px';
  badge.textContent = message;
  element.appendChild(badge);

  setTimeout(() => {
    if (badge.parentNode === element) element.removeChild(badge);
  }, 5000);
}

async function fetchConfigForPage() {
  const output = document.getElementById('config-json');
  if (!output) return;

  try {
    const response = await fetch('/admin/api/config', {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    output.style.color = '';
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    output.style.color = 'var(--color-danger)';
    output.textContent = `Error loading config: ${getErrorMessage(error)}`;
  }
}

async function reloadConfigForPage() {
  const button = document.getElementById('btn-reload-config');
  if (button) {
    button.disabled = true;
    button.textContent = 'Reloading...';
  }

  try {
    const response = await fetch('/admin/api/reload', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (
      response.ok || response.type === 'opaqueredirect' ||
      response.status === 0 || response.status === 302
    ) {
      showConfigStatus(
        `Config reloaded successfully at ${new Date().toLocaleTimeString()}`,
        false,
      );
      await fetchConfigForPage();
    } else {
      const body = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(body.error || 'Reload failed');
    }
  } catch (error) {
    showConfigStatus(`Reload failed: ${getErrorMessage(error)}`, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '\u21bb Reload Config';
    }
  }
}

function initializeConfigPage() {
  if (!document.getElementById('config-json')) return;

  fetchConfigForPage();

  const refreshButton = document.getElementById('btn-refresh-config');
  if (refreshButton) {
    bindOnce(refreshButton, 'config-refresh', () => {
      fetchConfigForPage();
    });
  }

  const reloadButton = document.getElementById('btn-reload-config');
  if (reloadButton) {
    bindOnce(reloadButton, 'config-reload', () => {
      reloadConfigForPage();
    });
  }
}

function makeBlocklistDeleteButton(type, value) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-danger';
  button.style.padding = '4px 10px';
  button.style.fontSize = '12px';
  button.textContent = 'Remove';
  button.addEventListener('click', () => {
    deleteBlocklistEntry(type, value);
  });
  return button;
}

function renderBlocklistTable(tbodyId, entries, type) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (!Array.isArray(entries) || entries.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.style.textAlign = 'center';
    cell.style.padding = '24px';
    cell.style.color = 'var(--color-text-muted)';
    cell.textContent = 'No entries';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('tr');
    const valueCell = document.createElement('td');
    valueCell.style.fontFamily = 'monospace';
    valueCell.style.fontSize = '13px';
    valueCell.textContent = entry;
    row.appendChild(valueCell);

    const actionCell = document.createElement('td');
    actionCell.appendChild(makeBlocklistDeleteButton(type, entry));
    row.appendChild(actionCell);

    tbody.appendChild(row);
  }
}

function showBlocklistError(containerId, message) {
  const container = document.getElementById(containerId);
  if (!container) return;

  while (container.firstChild) container.removeChild(container.firstChild);

  const paragraph = document.createElement('p');
  paragraph.style.color = 'var(--color-danger)';
  paragraph.style.padding = '12px 0';
  paragraph.textContent = `Error: ${message}`;
  container.appendChild(paragraph);
}

async function fetchBlocklistForPage() {
  try {
    const response = await fetch('/admin/api/blocklist', {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderBlocklistTable('ip-tbody', data.ips ?? [], 'ip');
    renderBlocklistTable('pubkey-tbody', data.pubkeys ?? [], 'pubkey');
  } catch (error) {
    const message = getErrorMessage(error);
    showBlocklistError('ip-list-container', message);
    showBlocklistError('pubkey-list-container', message);
  }
}

async function addBlocklistEntry(type, value) {
  if (!value) return;
  const body = type === 'ip' ? { ip: value } : { pubkey: value };

  try {
    const response = await fetch(`/admin/api/blocklist/${type}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(payload.error || 'Request failed');
    }
    await fetchBlocklistForPage();
  } catch (error) {
    alert(`Error adding entry: ${getErrorMessage(error)}`);
  }
}

async function deleteBlocklistEntry(type, value) {
  if (!confirm(`Remove ${value} from blocklist?`)) return;

  try {
    const response = await fetch(
      `/admin/api/blocklist/${type}/${encodeURIComponent(value)}`,
      {
        method: 'DELETE',
        credentials: 'same-origin',
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await fetchBlocklistForPage();
  } catch (error) {
    alert(`Error removing entry: ${getErrorMessage(error)}`);
  }
}

function addBlocklistInputHandlers(inputId, buttonId, emptyMessage, type) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  if (!input || !button) return;

  bindOnce(button, `blocklist-${type}-add`, () => {
    const value = input.value.trim();
    if (!value) {
      alert(emptyMessage);
      return;
    }
    addBlocklistEntry(type, value).then(() => {
      input.value = '';
    });
  });

  bindOnce(input, `blocklist-${type}-enter`, (event) => {
    if (event.key === 'Enter') button.click();
  }, 'keydown');
}

function initializeBlocklistPage() {
  if (!document.getElementById('ip-tbody') || !document.getElementById('pubkey-tbody')) return;

  fetchBlocklistForPage();

  const refreshButton = document.getElementById('btn-refresh');
  if (refreshButton) {
    bindOnce(refreshButton, 'blocklist-refresh', () => {
      fetchBlocklistForPage();
    });
  }

  addBlocklistInputHandlers(
    'ip-input',
    'btn-add-ip',
    'Please enter an IP address.',
    'ip',
  );
  addBlocklistInputHandlers(
    'pubkey-input',
    'btn-add-pubkey',
    'Please enter a pubkey.',
    'pubkey',
  );
}

function initializeClientEntryPageBehaviors() {
  initializeDashboardPage();
  initializeConnectionsPage();
  initializeMetricsPage();
  initializeLogsPage();
  initializeConfigPage();
  initializeBlocklistPage();
}

function installNavigation() {
  if (booted) return;
  booted = true;

  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || !shouldHandleAnchor(event, anchor)) return;

    event.preventDefault();
    navigate(anchor.href, 'push');
  });

  browserGlobal().addEventListener('popstate', () => {
    navigate(location.href, 'replace');
  });
}

function mountAdminIslands(islands, props) {
  for (const island of Object.values(islands ?? {})) {
    if (typeof island?.mount !== 'function') continue;
    island.mount(document, props);
  }
}

function addAdminIslandModulePath(paths, source, baseUrl) {
  try {
    const pathname = new URL(source, baseUrl).pathname;
    if (ADMIN_ISLAND_MODULES[pathname]) paths.add(pathname);
  } catch {
    // Ignore non-URL strings in inline module source.
  }
}

function addAdminIslandModulePathsFromSource(paths, sourceText, baseUrl) {
  const stringLiterals = sourceText.matchAll(/["']([^"']+)["']/g);
  for (const match of stringLiterals) {
    addAdminIslandModulePath(paths, match[1], baseUrl);
  }
}

function addAdminIslandModulePathsFromLinkHeader(paths, linkHeader, baseUrl) {
  if (!linkHeader) return;

  const linkTargets = linkHeader.matchAll(/<([^>]+)>/g);
  for (const match of linkTargets) {
    addAdminIslandModulePath(paths, match[1], baseUrl);
  }
}

function getAdminIslandModulePaths(doc, linkHeader, baseUrl) {
  const paths = new Set();
  doc.querySelectorAll('script[type="module"], link[rel="modulepreload"]')
    .forEach((element) => {
      const source = element.getAttribute('src') ??
        element.getAttribute('href');
      if (source) addAdminIslandModulePath(paths, source, baseUrl);
      addAdminIslandModulePathsFromSource(paths, element.textContent ?? '', baseUrl);
    });
  addAdminIslandModulePathsFromLinkHeader(paths, linkHeader, baseUrl);
  return paths;
}

async function mountAdminIslandsForDocument(doc, linkHeader, baseUrl) {
  const islands = {};
  for (const pathname of getAdminIslandModulePaths(doc, linkHeader, baseUrl)) {
    const mod = await ADMIN_ISLAND_MODULES[pathname]();
    islands[pathname] = mod.default;
  }
  mountAdminIslands(islands);
}

export function boot(islands = {}, props = []) {
  installNavigation();
  globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__ = { islands, props };
  mountLayoutBehaviors();
  initializeClientEntryPageBehaviors();
  mountAdminIslands(islands, props);
}

function shouldHandleAnchor(event, anchor) {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  if (!isClientNavEnabled(anchor)) return false;

  const url = new URL(anchor.href, location.href);
  return url.origin === location.origin && url.pathname.startsWith('/admin/');
}

function isClientNavEnabled(element) {
  for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
    const value = node.getAttribute('f-client-nav');
    if (value === 'false') return false;
    if (value !== null) return true;
  }
  return false;
}

async function navigate(url, historyMode) {
  if (navigating) return;
  navigating = true;

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    });

    if (!response.ok) {
      location.assign(url);
      return;
    }

    const html = await response.text();
    const responseUrl = response.url || url;
    const nextDocument = new DOMParser().parseFromString(html, 'text/html');
    const partialNames = getPartialNames(document);
    let replaced = 0;

    for (const name of partialNames) {
      const current = findPartial(document, name);
      const next = findPartial(nextDocument, name);
      if (!current || !next) continue;
      replacePartial(current, next);
      replaced += 1;
    }

    if (replaced === 0) {
      location.assign(response.url || url);
      return;
    }

    document.title = nextDocument.title;
    if (historyMode === 'push') {
      history.pushState(null, '', responseUrl);
    } else {
      history.replaceState(null, '', responseUrl);
    }

    mountLayoutBehaviors();
    initializeClientEntryPageBehaviors();
    await mountAdminIslandsForDocument(nextDocument, response.headers.get('Link'), responseUrl);
  } catch {
    location.assign(url);
  } finally {
    navigating = false;
  }
}

function getPartialNames(doc) {
  const names = new Set();
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  let node;
  while ((node = walker.nextNode())) {
    const name = parsePartialStart(node);
    if (name) names.add(name);
  }
  return names;
}

function findPartial(doc, name) {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (parsePartialStart(node) !== name) continue;

    let end = node.nextSibling;
    while (end && !(end.nodeType === Node.COMMENT_NODE && end.data.trim() === '/frsh:partial')) {
      end = end.nextSibling;
    }

    if (end) return { start: node, end };
  }
  return null;
}

function parsePartialStart(comment) {
  const value = comment.data.trim();
  if (!value.startsWith('frsh:partial:')) return '';
  return value.split(':')[2] ?? '';
}

function replacePartial(current, next) {
  const parent = current.start.parentNode;
  if (!parent) return;

  let node = current.start.nextSibling;
  while (node && node !== current.end) {
    const nextNode = node.nextSibling;
    node.remove();
    node = nextNode;
  }

  for (const replacement of nodesBetween(next.start, next.end)) {
    parent.insertBefore(document.importNode(replacement, true), current.end);
  }
}

function nodesBetween(start, end) {
  const nodes = [];
  let node = start.nextSibling;
  while (node && node !== end) {
    nodes.push(node);
    node = node.nextSibling;
  }
  return nodes;
}
