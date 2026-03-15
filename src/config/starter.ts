import { pfortnerInit } from '../pfortner.ts';
import type { ConnectionInfo, InfraContext, PolicyFactory } from '../plugins/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import type { PfortnerConfig, PipelineEntry } from './loader.ts';
import AjvModule from 'ajv';
// deno-lint-ignore no-explicit-any
const AjvClass = (AjvModule as any).default ?? AjvModule;
const ajv = new AjvClass({ allErrors: true });

interface ResolvedPipeline {
  factories: PolicyFactory[];
  direction: 'client' | 'server';
}

export interface RequestHandlerHooks {
  onConnect?: (connectionInfo: ConnectionInfo) => void;
  onDisconnect?: (connectionId: string) => void;
  blacklist?: { pubkeys: Set<string>; ips: Set<string> };
}

async function resolvePipeline(
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
    const factory = await plugin.initialize(entry.config ?? {}, infra);
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
  const clientPipeline = await resolvePipeline(config.pipelines.client, 'client', registry, infra);
  const serverPipeline = await resolvePipeline(config.pipelines.server, 'server', registry, infra);

  return (req: Request, conn: Deno.ServeHandlerInfo<Deno.NetAddr>) => {
    const clientIp = config.server.x_forwarded_for
      ? (req.headers.get('X-Forwarded-For') || ('hostname' in conn.remoteAddr ? conn.remoteAddr.hostname : ''))
      : ('hostname' in conn.remoteAddr ? conn.remoteAddr.hostname : '');

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

    if (hooks?.onConnect) {
      hooks.onConnect(instance.connectionInfo);
    }
    if (hooks?.onDisconnect) {
      const connectionId = instance.connectionInfo.connectionId;
      instance.on('clientDisconnect', () => {
        hooks.onDisconnect!(connectionId);
      });
    }

    return instance.createSession(req);
  };
}
