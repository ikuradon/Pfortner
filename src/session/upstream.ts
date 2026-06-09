export function createUpstreamHeaders(clientIp: string | undefined): HeadersInit {
  const headers: HeadersInit = {};
  if (clientIp) {
    headers['X-Forwarded-For'] = clientIp;
  }
  return headers;
}

export function closeUpstreamSocket(socket: WebSocketStream): void {
  try {
    socket.close();
  } catch {
    // WebSocketStream が既に closing/closed の場合は何もしない。
  }
}
