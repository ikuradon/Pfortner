import { parseContactList, type QueryFn } from './builder.ts';
import { nostrTools } from '../deps.ts';

function isContactListEvent(event: unknown): event is nostrTools.Event & { tags: string[][] } {
  if (typeof event !== 'object' || event === null) return false;
  const candidate = event as Record<string, unknown>;
  return typeof candidate.id === 'string' &&
    typeof candidate.pubkey === 'string' &&
    typeof candidate.kind === 'number' &&
    typeof candidate.created_at === 'number' &&
    typeof candidate.content === 'string' &&
    typeof candidate.sig === 'string' &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'));
}

export function parseRelayResponse(
  messages: unknown[][],
  subId: string,
  expectedAuthors: Set<string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const createdAtByPubkey = new Map<string, number>();
  for (const msg of messages) {
    if (msg[0] !== 'EVENT' || msg.length < 3 || msg[1] !== subId) {
      continue;
    }

    try {
      const event = msg[2];
      if (
        isContactListEvent(event) &&
        event.kind === 3 &&
        expectedAuthors.has(event.pubkey) &&
        nostrTools.validateEvent(event) &&
        nostrTools.verifyEvent(event)
      ) {
        const storedCreatedAt = createdAtByPubkey.get(event.pubkey) ?? -1;
        if (event.created_at > storedCreatedAt) {
          createdAtByPubkey.set(event.pubkey, event.created_at);
          result.set(event.pubkey, parseContactList(event));
        }
      }
    } catch {
      // Ignore malformed relay EVENT payloads.
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
      const expectedAuthors = new Set(pubkeys);
      const resolveMessages = () => {
        try {
          resolve(parseRelayResponse(messages, subId, expectedAuthors));
        } catch (e) {
          reject(e);
        }
      };
      const timer = setTimeout(() => {
        ws.close();
        resolveMessages();
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
              resolveMessages();
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
