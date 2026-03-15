// src/connections/manager.test.ts
import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { ConnectionManager } from './manager.ts';
import type { ManagedConnection } from './types.ts';

function mockConnection(id: string, ip: string, authorized = false): ManagedConnection {
  return {
    info: {
      connectionId: id,
      connectionIpAddr: ip,
      clientAuthorized: authorized,
      clientPubkey: authorized ? 'pk' : '',
    },
    clientIp: ip,
    sendNotice: () => Promise.resolve(),
    close: () => {},
    sendAuthChallenge: () => {},
  };
}

const defaultOpts = { max: 10, maxPerIp: 3, pressure: { softLimitPercent: 80, authGracePeriod: 30 } };

Deno.test('canAccept allows when under limits', () => {
  const conns = new Map<string, ManagedConnection>();
  const cm = new ConnectionManager(conns, defaultOpts);
  assertEquals(cm.canAccept('1.2.3.4').allowed, true);
});

Deno.test('canAccept rejects when global max reached', () => {
  const conns = new Map<string, ManagedConnection>();
  const cm = new ConnectionManager(conns, { ...defaultOpts, max: 2 });
  cm.register(mockConnection('c1', '1.1.1.1'));
  cm.register(mockConnection('c2', '2.2.2.2'));
  const result = cm.canAccept('3.3.3.3');
  assertEquals(result.allowed, false);
  assertEquals(result.statusCode, 503);
});

Deno.test('canAccept rejects when per-IP max reached', () => {
  const conns = new Map<string, ManagedConnection>();
  const cm = new ConnectionManager(conns, { ...defaultOpts, maxPerIp: 2 });
  cm.register(mockConnection('c1', '1.1.1.1'));
  cm.register(mockConnection('c2', '1.1.1.1'));
  const result = cm.canAccept('1.1.1.1');
  assertEquals(result.allowed, false);
  assertEquals(result.statusCode, 429);
});

Deno.test('unregister decrements counts', () => {
  const conns = new Map<string, ManagedConnection>();
  const cm = new ConnectionManager(conns, { ...defaultOpts, max: 2 });
  cm.register(mockConnection('c1', '1.1.1.1'));
  cm.register(mockConnection('c2', '1.1.1.1'));
  assertEquals(cm.canAccept('1.1.1.1').allowed, false);
  cm.unregister('c1');
  assertEquals(cm.canAccept('1.1.1.1').allowed, true);
});

Deno.test('getStats returns correct values', () => {
  const conns = new Map<string, ManagedConnection>();
  const cm = new ConnectionManager(conns, defaultOpts);
  cm.register(mockConnection('c1', '1.1.1.1', true));
  cm.register(mockConnection('c2', '2.2.2.2', false));
  const stats = cm.getStats();
  assertEquals(stats.active, 2);
  assertEquals(stats.authenticated, 1);
  assertEquals(stats.pressure, 'normal');
});

Deno.test('getStats returns elevated pressure when above soft limit', () => {
  const conns = new Map<string, ManagedConnection>();
  const cm = new ConnectionManager(conns, {
    max: 10,
    maxPerIp: 50,
    pressure: { softLimitPercent: 50, authGracePeriod: 30 },
  });
  for (let i = 0; i < 6; i++) cm.register(mockConnection(`c${i}`, `${i}.0.0.1`));
  assertEquals(cm.getStats().pressure, 'elevated');
});

Deno.test('getStats returns critical at max', () => {
  const conns = new Map<string, ManagedConnection>();
  const cm = new ConnectionManager(conns, {
    max: 3,
    maxPerIp: 50,
    pressure: { softLimitPercent: 90, authGracePeriod: 30 },
  });
  for (let i = 0; i < 3; i++) cm.register(mockConnection(`c${i}`, `${i}.0.0.1`));
  assertEquals(cm.getStats().pressure, 'critical');
});

Deno.test('pressure check sends auth challenge to unauthenticated connections', () => {
  const conns = new Map<string, ManagedConnection>();
  let challengeSent = false;
  const conn = mockConnection('c1', '1.1.1.1', false);
  conn.sendAuthChallenge = () => {
    challengeSent = true;
  };
  const cm = new ConnectionManager(conns, {
    max: 2,
    maxPerIp: 50,
    pressure: { softLimitPercent: 50, authGracePeriod: 30 },
  });
  cm.register(conn);
  cm.register(mockConnection('c2', '2.2.2.2', true));
  cm.runPressureCheck(); // manual trigger instead of interval
  assertEquals(challengeSent, true);
});
