import { h } from 'preact';
import type { AdminState } from '$admin/server.ts';
import { BlocklistPage } from '../routes/blocklist.tsx';
import { ConfigPage } from '../routes/config.tsx';
import { ConnectionsPage } from '../routes/connections.tsx';
import { DashboardPage } from '../routes/index.tsx';
import { LogsPage } from '../routes/logs.tsx';
import { MetricsPage } from '../routes/metrics.tsx';
import { PipelinesPage } from '../routes/pipelines.tsx';
import { buildDashboardHealth } from '../app/dashboard_model.ts';
import type { AdminPageRenderers } from './page_routes.ts';

function currentPath(req: Request): string {
  return new URL(req.url).pathname;
}

export function buildAdminPageRenderers(state: AdminState): AdminPageRenderers {
  return {
    dashboard: (ctx) =>
      ctx.render(
        h(DashboardPage, {
          currentPath: currentPath(ctx.req),
          health: buildDashboardHealth(state),
        }),
      ),
    connections: (ctx) => ctx.render(h(ConnectionsPage, { currentPath: currentPath(ctx.req) })),
    pipelines: (ctx) =>
      ctx.render(
        h(PipelinesPage, {
          currentPath: currentPath(ctx.req),
          pipelines: state.config.pipelines,
          plugins: state.pluginNames,
        }),
      ),
    metrics: (ctx) => ctx.render(h(MetricsPage, { currentPath: currentPath(ctx.req) })),
    blocklist: (ctx) => ctx.render(h(BlocklistPage, { currentPath: currentPath(ctx.req) })),
    config: (ctx) => ctx.render(h(ConfigPage, { currentPath: currentPath(ctx.req) })),
    logs: (ctx) => ctx.render(h(LogsPage, { currentPath: currentPath(ctx.req) })),
  };
}
