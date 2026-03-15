import { parseContactList, type QueryFn } from './builder.ts';

export function parseRelayResponse(messages: unknown[][]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const msg of messages) {
    if (msg[0] === 'EVENT' && msg.length >= 3) {
      const event = msg[2] as { pubkey: string; kind: number; tags: string[][] };
      if (event.kind === 3) {
        result.set(event.pubkey, parseContactList(event));
      }
    }
  }
  return result;
}

export function createRelayQueryFn(relayUrl: string, timeoutMs = 10000): QueryFn {
  return (pubkeys: string[]): Promise<Map<string, string[]>> => {
    if (pubkeys.length === 0) return Promise.resolve(new Map());

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl);
      const messages: unknown[][] = [];
      const subId = `wot-${crypto.randomUUID().slice(0, 8)}`;
      const timer = setTimeout(() => {
        ws.close();
        resolve(parseRelayResponse(messages));
      }, timeoutMs);

      ws.addEventListener('open', () => {
        const filter = { kinds: [3], authors: pubkeys };
        ws.send(JSON.stringify(['REQ', subId, filter]));
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (Array.isArray(msg)) {
            messages.push(msg);
            if (msg[0] === 'EOSE' && msg[1] === subId) {
              clearTimeout(timer);
              ws.send(JSON.stringify(['CLOSE', subId]));
              ws.close();
              resolve(parseRelayResponse(messages));
            }
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`Failed to connect to relay ${relayUrl}`));
      });
    });
  };
}
