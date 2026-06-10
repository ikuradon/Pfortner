// Lightweight Fresh-compatible partial navigation for the programmatic admin app.

const PAGE_INITIALIZERS = {
  '/admin/static/connections.js': 'initConnectionsPage',
  '/admin/static/metrics.js': 'initMetricsPage',
  '/admin/static/logs.js': 'initLogsPage',
};

const DASHBOARD_POLL_INTERVAL_MS = 5000;

const ADMIN_ISLAND_MODULES = {
  '/admin/static/islands/AdminIslandSmoke.js': () => import('./islands/AdminIslandSmoke.js'),
  '/admin/static/islands/PipelineWorkbench.js': () => import('./islands/PipelineWorkbench.js'),
};

let booted = false;
let navigating = false;
let dashboardPoller = null;

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

  window.addEventListener('popstate', () => {
    navigate(location.href, 'replace');
  });
}

function mountAdminIslands(islands) {
  for (const island of Object.values(islands ?? {})) {
    if (typeof island?.mount !== 'function') continue;
    island.mount(document);
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
  mountAdminIslands(islands);
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
    await initializePageModules();
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

async function initializePageModules() {
  const modulePaths = new Set();
  document.querySelectorAll('main script[type="module"][src]').forEach((script) => {
    const url = new URL(script.getAttribute('src'), location.href);
    if (PAGE_INITIALIZERS[url.pathname]) modulePaths.add(url.pathname);
  });

  for (const pathname of modulePaths) {
    const initializer = PAGE_INITIALIZERS[pathname];
    const mod = await import(pathname);
    if (typeof mod[initializer] === 'function') mod[initializer]();
  }
}
