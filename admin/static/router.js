import { el } from './dom.js';

export function versionStaticAssetPath(path, version = '') {
  if (!version) return path;
  const url = new URL(path, 'http://pfortner.local');
  url.searchParams.set('v', version);
  return url.pathname + url.search + url.hash;
}

export function normalizePath(pathname) {
  if (pathname === '/admin') return '/admin/';
  return pathname.endsWith('/') && pathname !== '/admin/' ? pathname.slice(0, -1) : pathname;
}

function updateActiveNav(pathname, documentRef) {
  const path = normalizePath(pathname);
  documentRef.querySelectorAll('.sidebar-nav a').forEach((link) => {
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

export function createAdminRouter({
  routes,
  modulePathForRoute = versionStaticAssetPath,
  documentRef = document,
  windowRef = window,
} = {}) {
  let currentCleanup = null;
  let renderVersion = 0;

  async function renderRoute(pathname) {
    const root = documentRef.getElementById('admin-app');
    if (!root) return;

    const path = normalizePath(pathname);
    const route = routes[path];
    const version = ++renderVersion;

    if (typeof currentCleanup === 'function') {
      currentCleanup();
    }
    currentCleanup = null;

    if (!route) {
      documentRef.title = 'Not Found - Pförtner Admin';
      updateActiveNav(path, documentRef);
      renderError(root, 'Unknown admin page: ' + path);
      return;
    }

    documentRef.title = route.title + ' - Pförtner Admin';
    updateActiveNav(path, documentRef);
    route.render(root);

    try {
      const pageModule = await import(modulePathForRoute(route.module));
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

    const url = new URL(link.href, windowRef.location.href);
    if (url.origin !== windowRef.location.origin) return false;
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
    documentRef.addEventListener('click', (event) => {
      const link = event.target.closest?.('a');
      if (!link || !shouldHandleLink(event, link)) return;
      event.preventDefault();
      const url = new URL(link.href, windowRef.location.href);
      const next = normalizePath(url.pathname);
      if (next !== normalizePath(windowRef.location.pathname)) {
        windowRef.history.pushState({}, '', next + url.search + url.hash);
      }
      renderRoute(next);
    });

    windowRef.addEventListener('popstate', () => {
      renderRoute(windowRef.location.pathname);
    });
  }

  function boot() {
    bindNavigation();
    renderRoute(windowRef.location.pathname);
  }

  return {
    boot,
    renderRoute,
    shouldHandleLink,
  };
}

export function bootAdminSpa(options) {
  const router = createAdminRouter(options);
  router.boot();
  return router;
}
