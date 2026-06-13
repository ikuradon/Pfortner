import { pfortnerInit } from '../pfortner.ts';
import type { InfraContext } from '../plugins/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import type { PfortnerConfig, PipelineEntry } from './loader.ts';
import {
  recordConnectionClosed,
  recordConnectionOpened,
  recordPipelineResult,
  registerRelayMessageMetrics,
} from '../infra/relay-metrics.ts';
import { createManagedConnection, registerManagedConnectionDisconnect } from './managed-connection-adapter.ts';
import { resolvePipeline } from './pipeline-resolver.ts';
import { evaluateRuntimeGuards } from './runtime-guards.ts';
import type { RequestHandler, RequestHandlerHooks } from './request-handler-types.ts';

export { resolvePipeline } from './pipeline-resolver.ts';
export type { RequestHandler, RequestHandlerHooks } from './request-handler-types.ts';

type RequestHandlerConfig = Pick<PfortnerConfig, 'auth' | 'pipelines'> & {
  server: Omit<PfortnerConfig['server'], 'port'> & {
    port?: number;
  };
};

export interface RequestHandlerOptions {
  trustProxy?: boolean;
}

export async function buildRequestHandler(
  config: RequestHandlerConfig,
  infra: InfraContext,
  registry: PluginRegistry,
  hooks?: RequestHandlerHooks,
  options: RequestHandlerOptions = {},
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

  return (req, conn) => {
    const guard = evaluateRuntimeGuards({ config, hooks, req, conn, trustProxy: options.trustProxy });
    if (guard.response) return guard.response;
    const { clientIp } = guard;

    const instance = pfortnerInit(config.server.upstream_relay, {
      clientIp,
      idleTimeout: config.server.idle_timeout,
      sendAuthOnConnect: config.auth?.send_on_connect,
      maxAuthAttempts: config.auth?.max_attempts,
      allowedAuthTimeDuration: config.auth?.allowed_time_duration,
      allowedAuthFutureTimeDuration: config.auth?.allowed_future_time_duration,
      upstreamRawAddress: config.server.upstream_raw_url,
      pubkeyBlocklist: hooks?.blocklist?.pubkeys,
      onPipelineResult: (_direction, action) => {
        recordPipelineResult(hooks?.throughputTracker, action);
      },
    });
    registerRelayMessageMetrics(instance, infra.metrics);
    const clientPolicies = clientPipeline.factories.map((factory) => factory(instance));
    const serverPolicies = serverPipeline.factories.map((factory) => factory(instance));
    instance.registerClientPipeline(clientPolicies);
    instance.registerServerPipeline(serverPolicies);

    const managed = createManagedConnection(instance, clientIp);
    registerManagedConnectionDisconnect(instance, { hooks, infra });
    instance.on('clientDisconnect', () => {
      recordConnectionClosed(infra.metrics, hooks?.connectionManager?.getStats().active ?? 0);
    });

    let session: Response;
    try {
      session = instance.createSession(req);
    } catch (e) {
      if (e instanceof TypeError && e.message.startsWith('Invalid Header:')) {
        return new Response('Bad Request', { status: 400 });
      }
      throw e;
    }

    hooks?.connectionManager?.register(managed);
    recordConnectionOpened(infra.metrics, hooks?.connectionManager?.getStats().active ?? 0);
    hooks?.onConnect?.(managed);

    return session;
  };
}
