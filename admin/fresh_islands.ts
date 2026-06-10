import type { App } from '@fresh/core';
import { IslandPreparer, ProdBuildCache, setBuildCache } from '@fresh/core/internal';
import * as AdminIslandSmokeModule from './islands/AdminIslandSmoke.tsx';

type AdminIslandModule = Record<string, unknown>;

interface AdminIslandSpec {
  module: AdminIslandModule;
  chunk: string;
  name: string;
}

const ADMIN_ISLAND_VERSION = 'admin-islands-v1';
const ADMIN_CLIENT_ENTRY = '/admin/static/fresh_nav.js';
export const ADMIN_ISLAND_SMOKE_CHUNK = '/admin/static/islands/AdminIslandSmoke.js';
export const ADMIN_ISLAND_SMOKE_BROWSER_MODULE = 'export default function AdminIslandSmoke() {}\n';

const ADMIN_ISLANDS: AdminIslandSpec[] = [
  {
    module: AdminIslandSmokeModule,
    chunk: ADMIN_ISLAND_SMOKE_CHUNK,
    name: 'AdminIslandSmoke',
  },
];

export function installAdminIslandBuildCache(app: App<unknown>): void {
  const islands = new Map();
  const preparer = new IslandPreparer();
  for (const spec of ADMIN_ISLANDS) {
    preparer.prepare(islands, spec.module, spec.chunk, spec.name, []);
  }

  const cache = new ProdBuildCache('.', {
    version: ADMIN_ISLAND_VERSION,
    clientEntry: ADMIN_CLIENT_ENTRY,
    fsRoutes: [],
    staticFiles: new Map(),
    islands,
    entryAssets: [],
  });

  setBuildCache(app, cache, 'production');
}
