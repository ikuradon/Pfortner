import { assertEquals } from '@std/assert';
import { createManagedConnection, registerManagedConnectionDisconnect } from './managed-connection-adapter.ts';

function makeInstance() {
  let disconnectHandler = () => {};
  const sent: string[] = [];
  let closeCode: number | undefined;
  let authChallenges = 0;

  return {
    instance: {
      connectionInfo: {
        connectionId: 'conn-1',
        connectionIpAddr: '203.0.113.10',
        clientAuthorized: false,
        clientPubkey: '',
      },
      sendMessageToClient: (message: string) => {
        sent.push(message);
        return Promise.resolve();
      },
      closeSocket: (code?: number) => {
        closeCode = code;
      },
      sendAuthMessage: () => {
        authChallenges++;
      },
      on: (_event: 'clientDisconnect', handler: () => void) => {
        disconnectHandler = handler;
      },
    },
    sent,
    get closeCode() {
      return closeCode;
    },
    get authChallenges() {
      return authChallenges;
    },
    disconnect: () => disconnectHandler(),
  };
}

Deno.test('managed connection adapter exposes pfortner instance operations', async () => {
  const context = makeInstance();
  const managed = createManagedConnection(context.instance, '203.0.113.10', '2026-01-01T00:00:00.000Z');

  await managed.sendNotice('hello');
  managed.close(1001);
  managed.sendAuthChallenge();

  assertEquals(managed.info.connectionId, 'conn-1');
  assertEquals(managed.clientIp, '203.0.113.10');
  assertEquals(managed.connectedAt, '2026-01-01T00:00:00.000Z');
  assertEquals(context.sent, [JSON.stringify(['NOTICE', 'hello'])]);
  assertEquals(context.closeCode, 1001);
  assertEquals(context.authChallenges, 1);
});

Deno.test('managed connection adapter wires disconnect cleanup hooks', () => {
  const context = makeInstance();
  const calls: string[] = [];

  registerManagedConnectionDisconnect(context.instance, {
    hooks: {
      connectionManager: {
        canAccept: () => ({ allowed: true }),
        register: () => {},
        unregister: (id: string) => calls.push(`unregister:${id}`),
        getStats: () => ({ active: 0, authenticated: 0, max: 1, perIpMax: 1, pressure: 'normal' as const }),
      } as any,
      onDisconnect: (id: string) => calls.push(`disconnect:${id}`),
    },
    infra: {
      upstreamPool: {
        getConnection: () => Promise.reject(new Error('not used')),
        notifyClientDisconnect: (id: string) => {
          calls.push(`upstream:${id}`);
        },
        closeAll: () => {},
      },
    },
  });

  context.disconnect();

  assertEquals(calls, [
    'unregister:conn-1',
    'disconnect:conn-1',
    'upstream:conn-1',
  ]);
});
