import { acceptPolicy, pfortnerInit, type Policy } from '../mod.ts';
import { loadConfigFromFile } from '../src/config/loader.ts';
import { buildRelayInfo } from '../src/config/relay-info.ts';
import { buildInfraContext } from '../src/infra/context.ts';
import { createPrometheusMetrics, type PrometheusMetrics } from '../src/infra/prometheus.ts';
import { type AdminState, createAdminHandler } from '../src/admin/server.ts';
import { createAdminApp } from '../admin/main.ts';
import { createPluginRegistry } from '../src/plugins/registry.ts';
import { ConfigManager } from '../src/config/manager.ts';
import { ConnectionManager } from '../src/connections/manager.ts';
import { ShutdownManager } from '../src/shutdown/manager.ts';
import { UpstreamProbe } from '../src/connections/upstream-probe.ts';
import { remoteHostnameFromConn, selectClientIp } from '../src/net/client-ip.ts';
import { redactUrlCredentials } from '../src/infra/redaction.ts';
import { dotenv, log, nostrTools } from './deps.ts';
dotenv.loadSync({ export: true });

const configPath = Deno.args.find((arg) => arg.endsWith('.yaml') || arg.endsWith('.yml'));

if (configPath) {
  const config = await loadConfigFromFile(configPath);

  let prometheusMetrics: PrometheusMetrics | undefined;
  if (config.infra?.metrics?.prometheus?.enabled) {
    prometheusMetrics = createPrometheusMetrics();
  }

  const infra = buildInfraContext({
    logging: config.infra?.metrics?.logging,
    httpTimeout: config.infra?.http?.default_timeout,
    httpUserAgent: config.infra?.http?.user_agent,
    metrics: prometheusMetrics,
  });
  let infraWithRedis = infra;
  if (config.infra?.redis?.url) {
    const { createRedisClient } = await import('../src/infra/redis.ts');
    const redis = await createRedisClient({
      url: config.infra.redis.url,
      keyPrefix: config.infra.redis.key_prefix,
    });
    infraWithRedis = { ...infra, redis };
    infra.logger.info('Connected to Redis', { url: redactUrlCredentials(config.infra.redis.url) });
  }

  if (!infraWithRedis.redis && config.infra?.kv?.path) {
    const { createKvClient } = await import('../src/infra/kv.ts');
    const kvClient = await createKvClient({ path: config.infra.kv.path });
    infraWithRedis = { ...infraWithRedis, redis: kvClient };
    infra.logger.info('Using Deno KV as backend', { path: config.infra.kv.path });
  }

  const { UpstreamPool } = await import('../src/upstream/pool.ts');
  const upstreamPool = new UpstreamPool(infra.logger);
  infraWithRedis = { ...infraWithRedis, upstreamPool };

  const registry = createPluginRegistry();

  if (config.plugins) {
    for (const spec of config.plugins) {
      await registry.loadExternal(spec);
      infra.logger.info('Loaded external plugin', { source: spec.url ?? spec.path });
    }
  }

  const adminState: AdminState = {
    config,
    pluginNames: registry.listNames(),
    connections: new Map(),
    blacklist: { pubkeys: new Set(), ips: new Set() },
    startTime: Date.now(),
    metrics: prometheusMetrics,
  };

  // Create ConnectionManager with shared Map reference
  const connectionManager = new ConnectionManager(adminState.connections, {
    max: config.server.connections?.max ?? 10000,
    maxPerIp: config.server.connections?.max_per_ip ?? 50,
    pressure: {
      softLimitPercent: config.server.connections?.pressure?.soft_limit_percent ?? 90,
      authGracePeriod: config.server.connections?.pressure?.auth_grace_period ?? 30,
    },
  });
  adminState.connectionManager = connectionManager;

  const releaseMap = new Map<string, () => void>();

  const abortController = new AbortController();

  const shutdownManager = new ShutdownManager(
    adminState.connections,
    {
      drainTimeout: config.server.shutdown?.drain_timeout ?? 30,
      forceAfter: config.server.shutdown?.force_after ?? 30,
    },
    async () => {
      connectionManager.stopPressureCheck();
      upstreamProbe?.stop();
      abortController.abort();
      await upstreamPool.closeAll();
    },
  );
  adminState.shutdownManager = shutdownManager;
  shutdownManager.start();

  // Create UpstreamProbe
  const upstreamProbe = UpstreamProbe.fromRelayUrl(
    config.server.upstream_relay,
    config.server.upstream_raw_url,
  );
  if (upstreamProbe) {
    adminState.upstreamProbe = upstreamProbe;
    upstreamProbe.start();
  }

  const manager = await ConfigManager.create(
    await Deno.readTextFile(configPath),
    infraWithRedis,
    registry,
    {
      onConnect: (managed) => {
        // Don't add to adminState.connections here — ConnectionManager.register() does it
        releaseMap.set(managed.info.connectionId, manager.acquireConnection());
      },
      onDisconnect: (connectionId) => {
        // Don't delete from adminState.connections here — ConnectionManager.unregister() does it
        releaseMap.get(connectionId)?.();
        releaseMap.delete(connectionId);
      },
      blacklist: adminState.blacklist,
      connectionManager,
      shutdownManager,
    },
  );

  adminState.configPath = configPath;
  adminState.reloadFn = async (yaml: string) => {
    if (shutdownManager.isDraining()) return;
    adminState.config = await manager.reload(yaml);
    infra.logger.info('Config reloaded', { generation: manager.generation });
  };

  try {
    Deno.addSignalListener('SIGHUP', async () => {
      if (shutdownManager.isDraining()) return;
      infra.logger.info('SIGHUP received, reloading config');
      try {
        const content = await Deno.readTextFile(configPath);
        adminState.config = await manager.reload(content);
        infra.logger.info('Config reloaded via SIGHUP', { generation: manager.generation });
      } catch (e) {
        infra.logger.error('Config reload failed', { error: String(e) });
      }
    });
  } catch {
    // SIGHUP not available on this platform
  }

  // Start pressure check
  connectionManager.startPressureCheck();

  infra.logger.info('Pfortner starting in config mode', { config: configPath, port: config.server.port });

  // Legacy separate admin port (kept for backward compatibility)
  if (config.admin?.enabled && config.admin?.port) {
    const adminHandler = createAdminHandler(adminState);
    Deno.serve({ hostname: '[::]', port: config.admin.port }, adminHandler);
    infra.logger.info('Admin API (legacy) started', { port: config.admin.port });
  }

  // Fresh admin UI handler for /admin/* on main port
  let adminAppHandler: ((req: Request) => Promise<Response>) | undefined;
  if (config.admin?.enabled) {
    adminAppHandler = createAdminApp(adminState);
    const adminUiPath = (config.admin as { path?: string }).path ?? '/admin';
    infra.logger.info('Admin UI started', { path: adminUiPath });
  }

  Deno.serve(
    { hostname: '[::]', port: config.server.port, signal: abortController.signal },
    async (req: Request, conn: Deno.ServeHandlerInfo<Deno.NetAddr>) => {
      const url = new URL(req.url);

      // Admin UI: delegate /admin/* to Fresh handler
      if (adminAppHandler && url.pathname.startsWith('/admin')) {
        return await adminAppHandler(req);
      }

      // Health check on main port (no auth required)
      if (url.pathname === '/health') {
        const stats = connectionManager.getStats();
        return new Response(
          JSON.stringify({ status: 'ok', connections: stats.active, pressure: stats.pressure }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (prometheusMetrics && url.pathname === '/metrics') {
        return new Response(prometheusMetrics.render(), {
          headers: { 'Content-Type': 'text/plain; version=0.0.4' },
        });
      }

      if (req.headers.get('accept') === 'application/nostr+json') {
        const info = buildRelayInfo(config);
        return new Response(JSON.stringify(info), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (req.headers.get('upgrade') !== 'websocket') {
        return new Response('Please use a Nostr client to connect.', { status: 400 });
      }
      return manager.getRequestHandler()(req, conn);
    },
  );
} else {
  const APP_PORT = Number(Deno.env.get('APP_PORT')) || 3000;
  const UPSTREAM_RELAY = Deno.env.get('UPSTREAM_RELAY');
  const TRUST_X_FORWARDED_FOR = Deno.env.get('TRUST_X_FORWARDED_FOR') === 'true' ||
    Deno.env.get('X_FORWARDED_FOR') === 'true';
  if (UPSTREAM_RELAY == undefined) {
    log.error('UPSTREAM_RELAY environment variable is required');
    Deno.exit(1);
  }

  let UPSTREAM_RAW_URL: string;
  try {
    UPSTREAM_RAW_URL = new URL(Deno.env.get('UPSTREAM_RAW_URL') || UPSTREAM_RELAY).href;
  } catch {
    log.error('Invalid UPSTREAM_RAW_URL');
    Deno.exit(1);
  }

  const UPSTREAM_URL_HTTP = UPSTREAM_RELAY.replace('wss://', 'https://').replace('ws://', 'http://');

  const appendNip42Proxy = async ({ upstreamHost }: { upstreamHost: string }): Promise<Response> => {
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Access-Control-Allow-Origin', '*');

    try {
      const response = await fetch(new URL(upstreamHost).href, {
        headers: {
          Accept: 'application/nostr+json',
        },
      });

      if (!response.ok) {
        throw new Error(`Upstream relay returned status ${response.status}`);
      }

      const relayInfo = await response.json();

      // Ensure supported_nips exists and is an array
      if (!Array.isArray(relayInfo.supported_nips)) {
        relayInfo.supported_nips = [];
      }

      // Add NIP-42 only if not already present
      if (!relayInfo.supported_nips.includes(42)) {
        relayInfo.supported_nips.push(42);
      }

      return new Response(JSON.stringify(relayInfo), { headers });
    } catch (error) {
      log.warn(`Failed to fetch upstream relay info: ${error instanceof Error ? error.message : String(error)}`);

      // Return a minimal relay info with NIP-42 support as fallback
      const fallbackInfo = {
        name: 'Pförtner Proxy',
        description: 'Nostr relay proxy with NIP-42 authentication',
        supported_nips: [42],
      };

      return new Response(JSON.stringify(fallbackInfo), { headers });
    }
  };

  const isRelatedEvent = (pubkey: string, event: nostrTools.Event): boolean => {
    if (event.pubkey === pubkey) return true;
    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1] === pubkey) return true;
    }
    return false;
  };

  const filterDmPolicy: Policy<Map<string, nostrTools.Event[]>> = (message, connectionInfo, stash) => {
    if (message[0] !== 'EVENT' || message.length !== 3) {
      return { message, action: 'next' };
    }

    const reqId = message[1] as string;
    const event = message[2] as nostrTools.Event;
    if (event.kind !== 4) {
      return { message, action: 'next' };
    }

    if (!connectionInfo.clientAuthorized) {
      const reqStash = stash?.get(reqId) ?? ([] as nostrTools.Event[]);
      reqStash.push(event);
      stash?.set(reqId, reqStash);
      return { message, action: 'reject' };
    } else if (isRelatedEvent(connectionInfo.clientPubkey, event)) {
      return { message, action: 'accept' };
    } else {
      return { message, action: 'reject' };
    }
  };

  globalThis.addEventListener('unhandledrejection', (e) => {
    log.error(`Unhandled rejection: ${e.reason}`);
    e.preventDefault();
  });

  Deno.serve(
    { hostname: '[::]', port: APP_PORT },
    async (req: Request, conn: Deno.ServeHandlerInfo<Deno.NetAddr>) => {
      if (req.headers.get('accept') === 'application/nostr+json') {
        return await appendNip42Proxy({ upstreamHost: UPSTREAM_URL_HTTP });
      }

      if (req.headers.get('upgrade') != 'websocket') {
        return new Response('Please use a Nostr client to connect.', { status: 400 });
      }

      const clientIp = selectClientIp(req, {
        remoteHostname: remoteHostnameFromConn(conn),
        trustForwardedFor: TRUST_X_FORWARDED_FOR,
      });

      const stash = new Map<string, nostrTools.Event[]>();

      const pfortner = pfortnerInit(UPSTREAM_RELAY, {
        clientIp,
        sendAuthOnConnect: true,
        upstreamRawAddress: UPSTREAM_RAW_URL,
      });

      pfortner.registerClientPipeline([acceptPolicy]);
      pfortner.registerServerPipeline([[filterDmPolicy, stash], acceptPolicy]);

      pfortner.on('clientRequest', (requestId) => {
        if (!pfortner.connectionInfo.clientAuthorized) {
          stash.set(requestId, [] as nostrTools.Event[]);
        }
      });
      pfortner.on('clientClose', (requestId) => {
        if (!pfortner.connectionInfo.clientAuthorized) {
          stash.delete(requestId);
        }
      });
      pfortner.on('authSuccess', (event) => {
        pfortner.sendMessageToClient(JSON.stringify(['OK', event.id, true, '']));

        stash.forEach((events: nostrTools.Event[], reqId: string) => {
          for (const event of events) {
            if (isRelatedEvent(pfortner.connectionInfo.clientPubkey, event)) {
              const msg = ['EVENT', reqId, event];
              pfortner.sendMessageToClient(JSON.stringify(msg));
            }
          }
        });
      });
      pfortner.on('clientDisconnect', () => {
        stash.clear();
      });

      return pfortner.createSession(req);
    },
  );
}
