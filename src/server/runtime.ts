import { createAdminApp } from '../../admin/main.ts';
import type { AdminState } from '../admin/server.ts';
import { pipelineDraftPathForConfig } from '../admin/pipeline_draft.ts';
import { ConnectionManager } from '../connections/manager.ts';
import { UpstreamProbe } from '../connections/upstream-probe.ts';
import { ConfigManager } from '../config/manager.ts';
import { loadProductionConfigFromString } from '../config/loader.ts';
import type { PfortnerConfig } from '../config/loader.ts';
import type { RequestHandlerHooks } from '../config/starter.ts';
import { buildInfraContext } from '../infra/context.ts';
import { createKvClient } from '../infra/kv.ts';
import { LogBuffer } from '../infra/log-buffer.ts';
import { createPrometheusMetrics } from '../infra/prometheus.ts';
import { createRedisClient } from '../infra/redis.ts';
import { redactUrlCredentials } from '../infra/redaction.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import type { RedisClient } from '../plugins/types.ts';
import { ShutdownManager } from '../shutdown/manager.ts';
import { UpstreamPool } from '../upstream/pool.ts';
import { resolveAdminAuth } from './admin_token.ts';
import { detectBootstrapState } from './bootstrap.ts';
import { ensureDataDirLayout } from './data_dir.ts';
import type { DataDirLayout } from './data_dir.ts';
import { parseServerEnv } from './env.ts';
import { createMainHandler } from './handler.ts';
import { createSetupHandler } from './setup_app.ts';
import type { ParsedServerEnv, RuntimeEnvelope } from './types.ts';

type ServeInfo = Deno.ServeHandlerInfo<Deno.NetAddr>;
type ProductionRuntimeConfig = ReturnType<typeof loadProductionConfigFromString>;

export interface CreateServerRuntimeOptions {
  env?: Pick<Map<string, string>, 'get'>;
  args?: string[];
}

export interface ServerRuntime {
  mode: 'setup' | 'normal';
  runtime: RuntimeEnvelope;
  handler: (req: Request, conn: ServeInfo) => Promise<Response>;
  shutdown(): Promise<void>;
}

export async function createServerRuntime(options: CreateServerRuntimeOptions = {}): Promise<ServerRuntime> {
  const parsed = parseServerEnv(options.env, options.args);
  const layout = await ensureDataDirLayout(parsed.dataDir);
  const bootstrap = await detectBootstrapState(layout);

  if (bootstrap.mode === 'setup') {
    if (!parsed.adminEnabled) {
      throw new Error('Admin UI is disabled and config.yaml is missing');
    }

    const redisUrl = await resolveRedisUrl(parsed);
    const backendAvailability = { kvAvailable: true, redisAvailable: redisUrl != null };
    const adminAuth = await resolveAdminAuth({
      enabled: true,
      token: parsed.adminToken,
      tokenFile: parsed.adminTokenFile,
    });
    const runtime = buildRuntimeEnvelope(parsed, layout.kvPath, adminAuth, redisUrl);
    const baseSetupHandler = createSetupHandler({ layout, runtime: { backend: backendAvailability } });
    let currentHandler: (req: Request, conn: ServeInfo) => Promise<Response>;
    let currentShutdown = async () => {};
    const serverRuntime: ServerRuntime = {
      mode: 'setup',
      runtime,
      handler: (req, conn) => currentHandler(req, conn),
      shutdown: () => currentShutdown(),
    };
    const setupHandler = async (req: Request): Promise<Response> => {
      const res = await baseSetupHandler(req);
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname === '/admin/setup' && res.status === 303) {
        const normalRuntime = await createNormalRuntime({
          parsed,
          layout,
          redisUrl,
          backendAvailability,
          adminAuth,
        });
        serverRuntime.mode = 'normal';
        serverRuntime.runtime = normalRuntime.runtime;
        currentHandler = normalRuntime.handler;
        currentShutdown = normalRuntime.shutdown;
      }
      return res;
    };
    currentHandler = createMainHandler({ mode: 'setup', setupHandler });

    return serverRuntime;
  }

  const redisUrl = await resolveRedisUrl(parsed);
  const backendAvailability = { kvAvailable: true, redisAvailable: redisUrl != null };
  return await createNormalRuntime({ parsed, layout, redisUrl, backendAvailability });
}

async function createNormalRuntime({
  parsed,
  layout,
  redisUrl,
  backendAvailability,
  adminAuth,
}: {
  parsed: ParsedServerEnv;
  layout: DataDirLayout;
  redisUrl: string | undefined;
  backendAvailability: { kvAvailable: boolean; redisAvailable: boolean };
  adminAuth?: RuntimeEnvelope['adminAuth'];
}): Promise<ServerRuntime> {
  let backendClient: RedisClient | undefined;
  let upstreamPool: UpstreamPool | undefined;
  let upstreamProbe: UpstreamProbe | null | undefined;
  let connectionManager: ConnectionManager | undefined;
  let pressureCheckStarted = false;
  let upstreamProbeStarted = false;
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (pressureCheckStarted) {
      connectionManager?.stopPressureCheck();
      pressureCheckStarted = false;
    }
    if (upstreamProbeStarted) {
      upstreamProbe?.stop();
      upstreamProbeStarted = false;
    }
    const closeErrors: unknown[] = [];
    if (upstreamPool) {
      try {
        await upstreamPool.closeAll();
      } catch (error) {
        closeErrors.push(error);
      }
    }
    if (backendClient) {
      try {
        await backendClient.close();
      } catch (error) {
        closeErrors.push(error);
      }
    }
    if (closeErrors.length > 0) throw closeErrors[0];
  };

  try {
    const resolvedAdminAuth = adminAuth ??
      (parsed.adminEnabled
        ? await resolveAdminAuth({
          enabled: true,
          token: parsed.adminToken,
          tokenFile: parsed.adminTokenFile,
        })
        : { enabled: false as const, path: '/admin' as const });
    const runtime = buildRuntimeEnvelope(parsed, layout.kvPath, resolvedAdminAuth, redisUrl);
    const yaml = await Deno.readTextFile(layout.configPath);
    const config = loadProductionConfigFromString(yaml, { backend: backendAvailability });
    let currentConfig = toLegacyConfig(config);
    const logBuffer = new LogBuffer(1000);
    const prometheusMetrics = config.infra?.metrics?.prometheus?.enabled ? createPrometheusMetrics() : undefined;
    const infra = buildInfraContext({
      logging: parsed.logging,
      httpTimeout: config.infra?.http?.default_timeout,
      httpUserAgent: config.infra?.http?.user_agent,
      metrics: prometheusMetrics,
      logSink: (line) => {
        console.log(line);
        logBuffer.push(line);
      },
    });

    let infraWithBackend = infra;
    if (redisUrl) {
      backendClient = await createRedisClient({ url: redisUrl, keyPrefix: parsed.redisKeyPrefix });
      infraWithBackend = { ...infraWithBackend, redis: backendClient };
      infra.logger.info('Connected to Redis', { url: redactUrlCredentials(redisUrl) });
    } else {
      backendClient = await createKvClient({ path: layout.kvPath });
      infraWithBackend = { ...infraWithBackend, redis: backendClient };
      infra.logger.info('Using Deno KV as backend', { path: layout.kvPath });
    }

    upstreamPool = new UpstreamPool(infra.logger);
    infraWithBackend = { ...infraWithBackend, upstreamPool };

    const registry = createPluginRegistry();
    for (const spec of config.plugins ?? []) {
      await registry.loadExternal(spec);
      infra.logger.info('Loaded external plugin', { source: spec.url ?? spec.path });
    }

    const adminState: AdminState = {
      config: currentConfig,
      adminAuth: resolvedAdminAuth,
      runtime: toAdminRuntimeState(runtime),
      pluginNames: registry.listNames(),
      connections: new Map(),
      blocklist: { pubkeys: new Set(), ips: new Set() },
      configPath: layout.configPath,
      pipelineDraftPath: resolvePipelineDraftPath(layout),
      startTime: Date.now(),
      metrics: prometheusMetrics,
      logBuffer,
    };

    connectionManager = new ConnectionManager(adminState.connections, {
      max: config.server.connections?.max ?? 10000,
      maxPerIp: config.server.connections?.max_per_ip ?? 50,
      pressure: {
        softLimitPercent: config.server.connections?.pressure?.soft_limit_percent ?? 90,
        authGracePeriod: config.server.connections?.pressure?.auth_grace_period ?? 30,
      },
    });
    adminState.connectionManager = connectionManager;

    const shutdownManager = new ShutdownManager(
      adminState.connections,
      {
        drainTimeout: config.server.shutdown?.drain_timeout ?? 30,
        forceAfter: config.server.shutdown?.force_after ?? 30,
      },
      cleanup,
    );
    adminState.shutdownManager = shutdownManager;

    upstreamProbe = UpstreamProbe.fromRelayUrl(config.server.upstream_relay, config.server.upstream_raw_url);
    if (upstreamProbe) adminState.upstreamProbe = upstreamProbe;

    const releaseMap = new Map<string, () => void>();
    const managerRef: { current?: ConfigManager<ProductionRuntimeConfig> } = {};
    const hooks: RequestHandlerHooks = {
      onConnect: (managed) => {
        if (!managerRef.current) throw new Error('Config manager is not initialized');
        releaseMap.set(managed.info.connectionId, managerRef.current.acquireConnection());
      },
      onDisconnect: (connectionId) => {
        releaseMap.get(connectionId)?.();
        releaseMap.delete(connectionId);
      },
      blocklist: adminState.blocklist,
      connectionManager,
      shutdownManager,
    };

    managerRef.current = await ConfigManager.create<ProductionRuntimeConfig>(
      yaml,
      infraWithBackend,
      registry,
      hooks,
      {
        loadConfig: (text) => loadProductionConfigFromString(text, { backend: backendAvailability }),
        requestHandlerOptions: { trustProxy: parsed.trustProxy },
      },
    );

    adminState.reloadFn = async (nextYaml: string) => {
      if (shutdownManager.isDraining()) return;
      const manager = managerRef.current!;
      const nextConfig = await manager.reload(nextYaml);
      currentConfig = toLegacyConfig(nextConfig);
      adminState.config = currentConfig;
      infra.logger.info('Config reloaded', { generation: manager.generation });
    };

    const adminHandler = resolvedAdminAuth.enabled ? createAdminApp(adminState) : undefined;
    const handler = createMainHandler({
      mode: 'normal',
      config: () => currentConfig,
      adminEnabled: resolvedAdminAuth.enabled,
      adminHandler,
      prometheusMetrics,
      health: () => {
        const stats = connectionManager!.getStats();
        return { status: 'ok', connections: stats.active, pressure: stats.pressure };
      },
      relayHandler: (req, conn) => managerRef.current!.getRequestHandler()(req, conn),
    });

    pressureCheckStarted = true;
    connectionManager.startPressureCheck();
    if (upstreamProbe) {
      upstreamProbeStarted = true;
      upstreamProbe.start();
    }
    shutdownManager.start();

    return {
      mode: 'normal',
      runtime,
      handler,
      shutdown: cleanup,
    };
  } catch (error) {
    try {
      await cleanup();
    } catch {
      // 起動失敗の元 error を優先して返す。
    }
    throw error;
  }
}

async function resolveRedisUrl(parsed: ParsedServerEnv): Promise<string | undefined> {
  if (parsed.redisUrl) return parsed.redisUrl;
  if (!parsed.redisUrlFile) return undefined;
  const value = (await Deno.readTextFile(parsed.redisUrlFile)).trim();
  return value || undefined;
}

function toAdminRuntimeState(runtime: RuntimeEnvelope): AdminState['runtime'] {
  return {
    logging: runtime.logging,
    trustProxy: runtime.trustProxy,
    admin: runtime.adminAuth.enabled
      ? { enabled: true, tokenSource: runtime.adminAuth.tokenSource }
      : { enabled: false },
  };
}

function buildRuntimeEnvelope(
  parsed: ParsedServerEnv,
  kvPath: string,
  adminAuth: RuntimeEnvelope['adminAuth'],
  redisUrl: string | undefined,
): RuntimeEnvelope {
  return {
    dataDir: parsed.dataDir,
    listen: parsed.listen,
    trustProxy: parsed.trustProxy,
    adminAuth,
    logging: parsed.logging,
    backend: {
      kv: { path: kvPath },
      ...(redisUrl
        ? {
          redis: {
            url: redisUrl,
            ...(parsed.redisKeyPrefix ? { keyPrefix: parsed.redisKeyPrefix } : {}),
          },
        }
        : {}),
    },
  };
}

function resolvePipelineDraftPath(layout: { configPath: string; pipelineDraftPath: string }): string {
  return layout.pipelineDraftPath || pipelineDraftPathForConfig(layout.configPath);
}

function toLegacyConfig(config: ProductionRuntimeConfig): PfortnerConfig {
  return config as PfortnerConfig;
}
