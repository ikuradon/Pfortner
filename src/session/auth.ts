import { log, nostrTools } from '../deps.ts';
import type { ConnectionInfo } from '../pfortner.ts';

export type AuthVerifierOptions = {
  connectionInfo: ConnectionInfo;
  relayAddress: string | null;
  allowedAuthTimeDuration: number;
  allowedAuthFutureTimeDuration: number;
  maxAuthAttempts: number;
  isBlockedPubkey(pubkey: unknown): boolean;
  onAuthSuccess(event: nostrTools.Event): void;
  onAuthFailed(): void;
  onBlocked(): void;
  now?: () => number;
};

export function resolveAuthRelayAddress(upstreamAddress: string, upstreamRawAddress?: string): string | null {
  try {
    return new URL(upstreamRawAddress || upstreamAddress).href;
  } catch {
    return null;
  }
}

export function createAuthVerifier(options: AuthVerifierOptions): (event: nostrTools.Event) => void {
  let authAttemptCount = 0;
  const usedAuthEventIds = new Set<string>();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  function validateEventTime(event: nostrTools.Event): boolean {
    const current = now();
    return (
      event.created_at > current - options.allowedAuthTimeDuration &&
      event.created_at < current + options.allowedAuthFutureTimeDuration
    );
  }

  return (event: nostrTools.Event): void => {
    authAttemptCount++;
    if (authAttemptCount > options.maxAuthAttempts) {
      log.warn(`AUTH rate limit exceeded connectionId=${options.connectionInfo.connectionId}`);
      options.onAuthFailed();
      return;
    }

    if (usedAuthEventIds.has(event.id)) {
      log.warn(`AUTH replay detected eventId=${event.id} connectionId=${options.connectionInfo.connectionId}`);
      options.onAuthFailed();
      return;
    }

    if (options.relayAddress == null) {
      log.error('Invalid relay address for AUTH verification');
      options.onAuthFailed();
      return;
    }

    if (
      nostrTools.validateEvent(event) &&
      nostrTools.verifyEvent(event) &&
      event.kind === 22242 &&
      validateEventTime(event)
    ) {
      let checkChallenge = false;
      let checkRelay = false;

      for (const tag of event.tags) {
        if (
          tag.length === 2 &&
          tag[0] === 'challenge' &&
          tag[1] === options.connectionInfo.connectionId
        ) {
          checkChallenge = true;
        } else if (tag.length === 2 && tag[0] === 'relay') {
          try {
            if (new URL(tag[1]).href === options.relayAddress) {
              checkRelay = true;
            }
          } catch {
            // tag 内の relay URL が不正な場合は一致しない扱いにする。
          }
        }
      }
      if (checkChallenge && checkRelay) {
        if (options.isBlockedPubkey(event.pubkey)) {
          log.warn(
            `AUTH blocked: pubkey in blocklist pubkey=${event.pubkey} connectionId=${options.connectionInfo.connectionId}`,
          );
          options.onAuthFailed();
          options.onBlocked();
          return;
        }
        usedAuthEventIds.add(event.id);
        options.connectionInfo.clientPubkey = event.pubkey;
        options.connectionInfo.clientAuthorized = true;
        options.onAuthSuccess(event);
      } else {
        options.onAuthFailed();
      }
    } else {
      options.onAuthFailed();
    }
  };
}
