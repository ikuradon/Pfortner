// src/conditions/context.ts
import type { EvalContext } from './types.ts';
import { extractEvent } from '../plugins/types.ts';

export function buildEvalContext(
  message: unknown[],
  connectionInfo: { clientAuthorized: boolean; clientPubkey: string; connectionIpAddr: string },
): EvalContext {
  const extracted = extractEvent(message);
  let hasSearch = false;
  if (message[0] === 'REQ') {
    for (let i = 2; i < message.length; i++) {
      const filter = message[i] as Record<string, unknown>;
      if (filter && 'search' in filter) {
        hasSearch = true;
        break;
      }
    }
  }
  return {
    authenticated: connectionInfo.clientAuthorized,
    pubkey: connectionInfo.clientPubkey,
    clientIp: connectionInfo.connectionIpAddr,
    messageType: (message[0] as string) ?? '',
    eventKind: extracted?.event?.kind ?? null,
    eventPubkey: extracted?.event?.pubkey ?? null,
    hasSearch,
  };
}
