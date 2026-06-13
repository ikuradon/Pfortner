// src/shutdown/manager.test.ts
import { assertEquals } from '@std/assert';
import { ShutdownManager } from './manager.ts';
import type { ManagedConnection } from '../connections/types.ts';

function mockConnection(id: string): ManagedConnection & { notices: string[]; closed: boolean } {
  const notices: string[] = [];
  let closed = false;
  return {
    info: { connectionId: id, connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    sendNotice: (msg) => {
      notices.push(msg);
      return Promise.resolve();
    },
    close: () => {
      closed = true;
    },
    sendAuthChallenge: () => {},
    notices,
    get closed() {
      return closed;
    },
  };
}

Deno.test('ShutdownManager isDraining is false initially', () => {
  const conns = new Map<string, ManagedConnection>();
  const sm = new ShutdownManager(conns, { drainTimeout: 1, forceAfter: 1 }, () => Promise.resolve());
  assertEquals(sm.isDraining(), false);
});

Deno.test('ShutdownManager isDraining is true after initiateShutdown', async () => {
  const conns = new Map<string, ManagedConnection>();
  let cleaned = false;
  const sm = new ShutdownManager(
    conns,
    { drainTimeout: 0, forceAfter: 0 },
    () => {
      cleaned = true;
      return Promise.resolve();
    },
    { exit: false },
  );
  await sm.initiateShutdown();
  assertEquals(sm.isDraining(), true);
  assertEquals(cleaned, true);
});

Deno.test('ShutdownManager sends notice to all connections', async () => {
  const conns = new Map<string, ManagedConnection>();
  const c1 = mockConnection('c1');
  const c2 = mockConnection('c2');
  conns.set('c1', c1);
  conns.set('c2', c2);

  const sm = new ShutdownManager(
    conns,
    { drainTimeout: 0, forceAfter: 0 },
    () => Promise.resolve(),
    { exit: false }, // test mode: don't call Deno.exit
  );
  await sm.initiateShutdown();
  assertEquals(c1.notices.length > 0, true);
  assertEquals(c2.notices.length > 0, true);
  assertEquals(c1.notices[0].includes('shutting down'), true);
});

Deno.test('ShutdownManager force closes remaining connections', async () => {
  const conns = new Map<string, ManagedConnection>();
  const c1 = mockConnection('c1');
  conns.set('c1', c1);

  const sm = new ShutdownManager(
    conns,
    { drainTimeout: 0, forceAfter: 0 },
    () => Promise.resolve(),
    { exit: false },
  );
  await sm.initiateShutdown();
  assertEquals(c1.closed, true);
});

Deno.test('ShutdownManager is idempotent', async () => {
  const conns = new Map<string, ManagedConnection>();
  let cleanupCount = 0;
  const sm = new ShutdownManager(
    conns,
    { drainTimeout: 0, forceAfter: 0 },
    () => {
      cleanupCount++;
      return Promise.resolve();
    },
    { exit: false },
  );
  await sm.initiateShutdown();
  await sm.initiateShutdown(); // second call should be no-op
  assertEquals(cleanupCount, 1);
});
