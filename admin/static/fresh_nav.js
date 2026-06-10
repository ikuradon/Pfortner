// Lightweight Fresh-compatible partial navigation for the programmatic admin app.

const PAGE_INITIALIZERS = {
  '/admin/static/dashboard.js': 'initDashboardPage',
  '/admin/static/connections.js': 'initConnectionsPage',
  '/admin/static/pipelines.js': 'initPipelinesPage',
  '/admin/static/metrics.js': 'initMetricsPage',
  '/admin/static/blocklist.js': 'initBlocklistPage',
  '/admin/static/config.js': 'initConfigPage',
  '/admin/static/logs.js': 'initLogsPage',
};

let booted = false;
let navigating = false;

export function boot() {
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
      history.pushState(null, '', response.url || url);
    } else {
      history.replaceState(null, '', response.url || url);
    }

    await initializePageModules();
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
