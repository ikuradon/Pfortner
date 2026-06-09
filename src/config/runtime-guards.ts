import { remoteHostnameFromConn, selectClientIp } from '../net/client-ip.ts';
import type { PfortnerConfig } from './loader.ts';
import type { RequestHandlerHooks } from './request-handler-types.ts';

export type RuntimeGuardResult = {
  clientIp: string;
  response?: Response;
};

export function evaluateRuntimeGuards({
  config,
  hooks,
  req,
  conn,
}: {
  config: PfortnerConfig;
  hooks?: RequestHandlerHooks;
  req: Request;
  conn: Deno.ServeHandlerInfo<Deno.NetAddr>;
}): RuntimeGuardResult {
  const clientIp = selectClientIp(req, {
    remoteHostname: remoteHostnameFromConn(conn),
    trustForwardedFor: config.server.x_forwarded_for === true,
  });

  if (hooks?.shutdownManager?.isDraining()) {
    return { clientIp, response: new Response('Service Unavailable', { status: 503 }) };
  }

  if (hooks?.connectionManager) {
    const result = hooks.connectionManager.canAccept(clientIp);
    if (!result.allowed) {
      return {
        clientIp,
        response: new Response(result.reason ?? 'Too Many Requests', { status: result.statusCode ?? 429 }),
      };
    }
  }

  if (hooks?.blocklist?.ips.has(clientIp)) {
    return { clientIp, response: new Response('Forbidden', { status: 403 }) };
  }

  return { clientIp };
}
