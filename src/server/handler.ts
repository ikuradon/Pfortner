import { buildRelayInfo } from '../config/relay-info.ts';
import type { PfortnerConfig } from '../config/loader.ts';
import type { PrometheusMetrics } from '../infra/prometheus.ts';

type ServeInfo = Deno.ServeHandlerInfo<Deno.NetAddr>;
type ConfigProvider = PfortnerConfig | (() => PfortnerConfig);

export type MainHandlerRuntime =
  | {
    mode: 'setup';
    setupHandler: (req: Request) => Promise<Response>;
  }
  | {
    mode: 'normal';
    config: ConfigProvider;
    adminEnabled: boolean;
    adminHandler?: (req: Request) => Promise<Response>;
    prometheusMetrics?: PrometheusMetrics;
    health: () => unknown;
    relayHandler: (req: Request, conn: ServeInfo) => Response | Promise<Response>;
  };

export function createMainHandler(runtime: MainHandlerRuntime): (req: Request, conn: ServeInfo) => Promise<Response> {
  return async (req, conn) => {
    const url = new URL(req.url);
    if (runtime.mode === 'setup') {
      if (url.pathname.startsWith('/admin')) return await runtime.setupHandler(req);
      if (url.pathname === '/health') return json({ status: 'setup_required' });
      if (req.headers.get('upgrade') === 'websocket') return new Response('setup_required', { status: 503 });
      if (req.headers.get('accept') === 'application/nostr+json') {
        return new Response('setup_required', { status: 503 });
      }
      return new Response('Please complete setup in /admin.', { status: 503 });
    }

    if (runtime.adminEnabled && runtime.adminHandler && url.pathname.startsWith('/admin')) {
      return await runtime.adminHandler(req);
    }
    if (url.pathname === '/health') return json(runtime.health());
    if (runtime.prometheusMetrics && url.pathname === '/metrics') {
      return new Response(runtime.prometheusMetrics.render(), {
        headers: { 'Content-Type': 'text/plain; version=0.0.4' },
      });
    }
    if (req.headers.get('accept') === 'application/nostr+json') {
      return json(buildRelayInfo(resolveConfig(runtime.config)), 200, { 'Access-Control-Allow-Origin': '*' });
    }
    if (req.headers.get('upgrade') !== 'websocket') {
      return new Response('Please use a Nostr client to connect.', { status: 400 });
    }
    return await runtime.relayHandler(req, conn);
  };
}

function resolveConfig(config: ConfigProvider): PfortnerConfig {
  return typeof config === 'function' ? config() : config;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
