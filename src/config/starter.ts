import { pfortnerInit } from '../pfortner.ts';
import type { InfraContext, PolicyFactory } from '../plugins/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import type { PfortnerConfig, PipelineEntry } from './loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { ConnectionManager } from '../connections/manager.ts';
import type { ShutdownManager } from '../shutdown/manager.ts';
import AjvModule from 'ajv';
// deno-lint-ignore no-explicit-any
const AjvClass = (AjvModule as any).default ?? AjvModule;
const ajv = new AjvClass({ allErrors: true });

interface ResolvedPipeline {
  factories: PolicyFactory[];
  direction: 'client' | 'server';
}

export interface RequestHandlerHooks {
  onConnect?: (managed: ManagedConnection) => void;
  onDisconnect?: (connectionId: string) => void;
  blacklist?: { pubkeys: Set<string>; ips: Set<string> };
  connectionManager?: ConnectionManager;
  shutdownManager?: ShutdownManager;
}

export async function resolvePipeline(
  entries: PipelineEntry[],
  direction: 'client' | 'server',
  registry: PluginRegistry,
  infra: InfraContext,
): Promise<ResolvedPipeline> {
  const factories: PolicyFactory[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const plugin = registry.resolve(entry.policy);
    if (plugin.direction !== 'both' && plugin.direction !== direction) {
      throw new Error(
        `Plugin "${plugin.name}" has direction "${plugin.direction}" but is placed in "${direction}" pipeline (pipelines.${direction}[${i}])`,
      );
    }
    if (entry.config && Object.keys(plugin.configSchema).length > 0) {
      const validate = ajv.compile(plugin.configSchema);
      if (!validate(entry.config)) {
        const errors = validate.errors?.map((e: any) => `${e.instancePath} ${e.message}`).join('; ');
        throw new Error(
          `Config validation failed for plugin "${plugin.name}" at pipelines.${direction}[${i}]: ${errors}`,
        );
      }
    }
    const infraForPlugin: InfraContext = { ...infra, currentDirection: direction };
    const factory = await plugin.initialize(entry.config ?? {}, infraForPlugin);
    factories.push(factory);
  }
  return { factories, direction };
}

export type RequestHandler = (req: Request, conn: Deno.ServeHandlerInfo<Deno.NetAddr>) => Response;

export async function buildRequestHandler(
  config: PfortnerConfig,
  infra: InfraContext,
  registry: PluginRegistry,
  hooks?: RequestHandlerHooks,
): Promise<RequestHandler> {
  const infraWithResolver: InfraContext = {
    ...infra,
    pipelineResolver: async (entries, direction) => {
      const resolved = await resolvePipeline(
        entries as PipelineEntry[],
        direction,
        registry,
        infraWithResolver,
      );
      return resolved.factories;
    },
  };
  const clientPipeline = await resolvePipeline(config.pipelines.client, 'client', registry, infraWithResolver);
  const serverPipeline = await resolvePipeline(config.pipelines.server, 'server', registry, infraWithResolver);

  return (req: Request, conn: Deno.ServeHandlerInfo<Deno.NetAddr>) => {
    const clientIp = config.server.x_forwarded_for
      ? (req.headers.get('X-Forwarded-For') || ('hostname' in conn.remoteAddr ? conn.remoteAddr.hostname : ''))
      : ('hostname' in conn.remoteAddr ? conn.remoteAddr.hostname : '');

    // Draining check
    if (hooks?.shutdownManager?.isDraining()) {
      return new Response('Service Unavailable', { status: 503 });
    }

    // Connection limit check
    if (hooks?.connectionManager) {
      const result = hooks.connectionManager.canAccept(clientIp);
      if (!result.allowed) {
        return new Response(result.reason ?? 'Too Many Requests', { status: result.statusCode ?? 429 });
      }
    }

    // Runtime blacklist check
    if (hooks?.blacklist?.ips.has(clientIp)) {
      return new Response('Forbidden', { status: 403 });
    }

    const instance = pfortnerInit(config.server.upstream_relay, {
      clientIp,
      idleTimeout: config.server.idle_timeout,
      sendAuthOnConnect: config.auth?.send_on_connect,
      maxAuthAttempts: config.auth?.max_attempts,
      allowedAuthTimeDuration: config.auth?.allowed_time_duration,
      allowedAuthFutureTimeDuration: config.auth?.allowed_future_time_duration,
      upstreamRawAddress: config.server.upstream_raw_url,
    });
    const clientPolicies = clientPipeline.factories.map((factory) => factory(instance));
    const serverPolicies = serverPipeline.factories.map((factory) => factory(instance));
    instance.registerClientPipeline(clientPolicies);
    instance.registerServerPipeline(serverPolicies);
    infra.metrics.counter('pfortner_connections_total');

    const managed: ManagedConnection = {
      info: instance.connectionInfo,
      clientIp,
      sendNotice: (msg) => instance.sendMessageToClient(JSON.stringify(['NOTICE', msg])),
      close: (code) => instance.closeSocket(code),
      sendAuthChallenge: () => instance.sendAuthMessage(),
    };

    if (hooks?.connectionManager) {
      hooks.connectionManager.register(managed);
    }
    if (hooks?.onConnect) {
      hooks.onConnect(managed);
    }

    // Always register disconnect handler if connectionManager OR onDisconnect OR upstreamPool exists
    if (hooks?.connectionManager || hooks?.onDisconnect || infra.upstreamPool) {
      const connectionId = instance.connectionInfo.connectionId;
      instance.on('clientDisconnect', () => {
        hooks?.connectionManager?.unregister(connectionId);
        hooks?.onDisconnect?.(connectionId);
        infra.upstreamPool?.notifyClientDisconnect(connectionId);
      });
    }

    return instance.createSession(req);
  };
}
