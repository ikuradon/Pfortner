// Lightweight Fresh-compatible partial navigation for the programmatic admin app.

const PAGE_INITIALIZERS = {
  '/admin/static/dashboard.js': 'initDashboardPage',
  '/admin/static/connections.js': 'initConnectionsPage',
  '/admin/static/metrics.js': 'initMetricsPage',
  '/admin/static/blocklist.js': 'initBlocklistPage',
  '/admin/static/logs.js': 'initLogsPage',
};

const ADMIN_ISLAND_MODULES = {
  '/admin/static/islands/AdminIslandSmoke.js': () => import('./islands/AdminIslandSmoke.js'),
  '/admin/static/islands/PipelineWorkbench.js': () => import('./islands/PipelineWorkbench.js'),
};

let booted = false;
let navigating = false;

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

function bindOnce(element, key, listener) {
  const attribute = `data-pfortner-${key}-bound`;
  if (element.getAttribute(attribute) === 'true') return;
  element.setAttribute(attribute, 'true');
  element.addEventListener('click', listener);
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

function initializeClientEntryPageBehaviors() {
  initializeConfigPage();
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
