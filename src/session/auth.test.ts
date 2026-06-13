import { assertEquals } from '@std/assert';
import { nostrTools } from '../deps.ts';
import { createAuthVerifier, resolveAuthRelayAddress } from './auth.ts';
import type { ConnectionInfo } from '../pfortner.ts';

const sk = nostrTools.generateSecretKey();
const pk = nostrTools.getPublicKey(sk);

function makeAuthEvent(challenge: string, relay: string, createdAt = Math.floor(Date.now() / 1000)): nostrTools.Event {
  return nostrTools.finalizeEvent({
    kind: 22242,
    created_at: createdAt,
    tags: [
      ['challenge', challenge],
      ['relay', relay],
    ],
    content: '',
  }, sk);
}

function makeConnectionInfo(): ConnectionInfo {
  return {
    connectionId: 'challenge-1',
    connectionIpAddr: '127.0.0.1',
    clientAuthorized: false,
    clientPubkey: '',
  };
}

Deno.test('auth verifier authorizes valid NIP-42 AUTH events', () => {
  const connectionInfo = makeConnectionInfo();
  let success = 0;
  const verify = createAuthVerifier({
    connectionInfo,
    relayAddress: 'ws://relay.example/',
    allowedAuthTimeDuration: 600,
    allowedAuthFutureTimeDuration: 60,
    maxAuthAttempts: 10,
    isBlockedPubkey: () => false,
    onAuthSuccess: () => success++,
    onAuthFailed: () => {},
    onBlocked: () => {},
  });

  verify(makeAuthEvent('challenge-1', 'ws://relay.example/'));

  assertEquals(success, 1);
  assertEquals(connectionInfo.clientAuthorized, true);
  assertEquals(connectionInfo.clientPubkey, pk);
});

Deno.test('auth verifier rejects replays and blocked pubkeys', () => {
  const replayInfo = makeConnectionInfo();
  let replayFailures = 0;
  const replayVerifier = createAuthVerifier({
    connectionInfo: replayInfo,
    relayAddress: 'ws://relay.example/',
    allowedAuthTimeDuration: 600,
    allowedAuthFutureTimeDuration: 60,
    maxAuthAttempts: 10,
    isBlockedPubkey: () => false,
    onAuthSuccess: () => {},
    onAuthFailed: () => replayFailures++,
    onBlocked: () => {},
  });
  const event = makeAuthEvent('challenge-1', 'ws://relay.example/');
  replayVerifier(event);
  replayVerifier(event);

  const blockedInfo = makeConnectionInfo();
  let blocked = 0;
  const blockedVerifier = createAuthVerifier({
    connectionInfo: blockedInfo,
    relayAddress: 'ws://relay.example/',
    allowedAuthTimeDuration: 600,
    allowedAuthFutureTimeDuration: 60,
    maxAuthAttempts: 10,
    isBlockedPubkey: () => true,
    onAuthSuccess: () => {},
    onAuthFailed: () => {},
    onBlocked: () => blocked++,
  });
  blockedVerifier(makeAuthEvent('challenge-1', 'ws://relay.example/'));

  assertEquals(replayFailures, 1);
  assertEquals(blocked, 1);
});

Deno.test('auth helper resolves relay address safely', () => {
  assertEquals(resolveAuthRelayAddress('ws://relay.example', undefined), 'ws://relay.example/');
  assertEquals(resolveAuthRelayAddress('ws://relay.example', 'not a url'), null);
});
