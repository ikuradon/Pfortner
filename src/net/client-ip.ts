export interface ClientIpOptions {
  remoteHostname?: string;
  trustForwardedFor?: boolean;
}

export function remoteHostnameFromConn(conn: Deno.ServeHandlerInfo<Deno.NetAddr>): string {
  return 'hostname' in conn.remoteAddr ? conn.remoteAddr.hostname : '';
}

export function selectClientIp(req: Request, options: ClientIpOptions): string {
  if (options.trustForwardedFor === true) {
    const forwardedFor = firstForwardedFor(req.headers.get('X-Forwarded-For'));
    if (forwardedFor !== '') {
      return forwardedFor;
    }
  }

  return options.remoteHostname ?? '';
}

function firstForwardedFor(header: string | null): string {
  if (header == null) {
    return '';
  }

  return header.split(',')[0].trim();
}
