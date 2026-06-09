import { createPageRoutes } from './page_templates.js';
import { bootAdminSpa, versionStaticAssetPath as applyVersionStaticAssetPath } from './router.js';

globalThis.__PFORTNER_SPA__ = true;

const assetVersion = new URL(import.meta.url).searchParams.get('v') ?? '';

export function versionStaticAssetPath(path, version = assetVersion) {
  return applyVersionStaticAssetPath(path, version);
}

export function boot() {
  return bootAdminSpa({
    routes: createPageRoutes(),
    modulePathForRoute: (path) => versionStaticAssetPath(path),
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
