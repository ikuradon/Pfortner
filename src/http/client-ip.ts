export function resolveClientIp(
  req: Request,
  conn: Deno.ServeHandlerInfo<Deno.NetAddr>,
  trustForwardedFor = false,
): string {
  if (trustForwardedFor) {
    const forwardedFor = req.headers.get('X-Forwarded-For');
    if (forwardedFor) return forwardedFor;
  }

  return 'hostname' in conn.remoteAddr ? conn.remoteAddr.hostname : '';
}
