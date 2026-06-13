import { assertEquals, assertExists } from '@std/assert';
import {
  closeConnection,
  closeConnectionBatch,
  getConnections,
  getHealthDetail,
  getHealthSimple,
  getLogs,
  getRuntimeInfo,
  getThroughputData,
  maskSecrets,
  simulatePipeline,
} from './service.ts';
import type { AdminServiceState } from './service.ts';
import type { ManagedConnection } from '../connections/types.ts';
import { LogBuffer } from '../infra/log-buffer.ts';
import { ThroughputTracker } from '../infra/throughput-tracker.ts';

function mockConn(id: string): ManagedConnection {
  return {
    info: { connectionId: id, connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    connectedAt: '2026-01-01T00:00:00.000Z',
    sendNotice: async () => {},
    close: () => {},
    sendAuthChallenge: () => {},
  };
}

function makeState(overrides: Partial<AdminServiceState> = {}): AdminServiceState {
  return {
    config: {
      server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
      pipelines: { client: [], server: [] },
    } as any,
    pluginNames: ['accept'],
    connections: new Map(),
    blocklist: { pubkeys: new Set(), ips: new Set() },
    adminAuth: { enabled: true, path: '/admin', token: 'test-token', tokenSource: 'env' },
    runtime: {
      logging: { level: 'info', format: 'text' },
      trustProxy: false,
      admin: { enabled: true, tokenSource: 'env' },
    },
    ...overrides,
  };
}

Deno.test('maskSecrets masks auth_token', () => {
  const state = makeState();
  state.config.admin = { enabled: true, auth_token: 'secret' } as any;
  const masked = maskSecrets(state.config) as any;
  assertEquals(masked.admin.auth_token, '***');
});

Deno.test('getHealthSimple returns ok', () => {
  assertEquals(getHealthSimple(makeState()).status, 'ok');
});

Deno.test('getHealthSimple returns draining', () => {
  const state = makeState({ shutdownManager: { isDraining: () => true, initiateShutdown: async () => {} } });
  assertEquals(getHealthSimple(state).status, 'draining');
});

Deno.test('getConnections returns connection info', () => {
  const state = makeState();
  state.connections.set('c1', mockConn('c1'));
  const conns = getConnections(state);
  assertEquals(conns.length, 1);
  assertEquals(conns[0].id, 'c1');
  assertEquals(conns[0].ip, '127.0.0.1');
  assertEquals(conns[0].authenticated, false);
  assertEquals(conns[0].pubkey, '');
  assertEquals(conns[0].connectedAt, '2026-01-01T00:00:00.000Z');
});

Deno.test('closeConnection closes and returns found', () => {
  const state = makeState();
  state.connections.set('c1', mockConn('c1'));
  assertEquals(closeConnection(state, 'c1').found, true);
});

Deno.test('closeConnection returns not found', () => {
  assertEquals(closeConnection(makeState(), 'nonexistent').found, false);
});

Deno.test('closeConnectionBatch closes multiple', () => {
  const state = makeState();
  state.connections.set('c1', mockConn('c1'));
  state.connections.set('c2', mockConn('c2'));
  const result = closeConnectionBatch(state, ['c1', 'c2', 'c3']);
  assertEquals(result.closed.length, 2);
  assertEquals(result.notFound, ['c3']);
});

Deno.test('getHealthDetail returns required fields', () => {
  const state = makeState({
    startTime: Date.now() - 5000,
    shutdownManager: { isDraining: () => false, initiateShutdown: async () => {} },
    connectionManager: { getStats: () => ({ active: 0 }) },
    upstreamProbe: { getLatency: () => 42, getStatus: () => 'ok' },
  });
  const detail = getHealthDetail(state) as any;
  assertExists(detail.uptime_seconds);
  assertExists(detail.connections);
  assertExists(detail.upstream);
  assertExists(detail.shutdown);
  assertEquals(detail.status, 'ok');
  assertEquals(detail.upstream.latency_ms, 42);
  assertEquals(detail.upstream.status, 'ok');
  assertEquals(detail.shutdown.draining, false);
});

Deno.test('getHealthDetail memory returns raw bytes fields', () => {
  const state = makeState();
  const detail = getHealthDetail(state) as any;
  // memory may be null in some environments, but if present must have rss/heapUsed/heapTotal
  if (detail.memory !== null) {
    assertExists(detail.memory.rss);
    assertExists(detail.memory.heapUsed);
    assertExists(detail.memory.heapTotal);
    assertEquals(typeof detail.memory.rss, 'number');
    assertEquals(typeof detail.memory.heapUsed, 'number');
    assertEquals(typeof detail.memory.heapTotal, 'number');
  }
});

Deno.test('getHealthDetail with no optional fields does not crash', () => {
  const state = makeState();
  // no startTime, no shutdownManager, no connectionManager, no upstreamProbe
  const detail = getHealthDetail(state) as any;
  assertEquals(detail.uptime_seconds, 0);
  assertEquals(detail.status, 'ok');
  assertEquals(detail.shutdown.draining, false);
  assertEquals(detail.upstream.latency_ms, null);
  assertEquals(detail.upstream.status, 'unknown');
});

Deno.test('getThroughputData returns empty array when no tracker', () => {
  const state = makeState();
  assertEquals(getThroughputData(state), []);
});

Deno.test('getThroughputData returns data when tracker exists', () => {
  const tracker = new ThroughputTracker(5, 1000);
  tracker.recordAccept();
  const state = makeState({ throughputTracker: tracker });
  const data = getThroughputData(state) as any[];
  assertEquals(data.length, 5);
  assertEquals(typeof data[0].timestamp, 'number');
});

Deno.test('getLogs returns empty result when no log buffer exists', () => {
  const result = getLogs(makeState());
  assertEquals(result.logs, []);
  assertEquals(result.total, 0);
  assertEquals(result.subscribers, 0);
});

Deno.test('getLogs returns buffered log entries', () => {
  const logBuffer = new LogBuffer(5);
  logBuffer.push('first');
  logBuffer.push('second');
  const result = getLogs(makeState({ logBuffer }), 1);

  assertEquals(result.logs.length, 1);
  assertEquals(result.logs[0].line, 'second');
  assertEquals(result.total, 2);
  assertEquals(result.subscribers, 0);
});

Deno.test('getRuntimeInfo returns logging and trust proxy without secrets', () => {
  const state = makeState();
  state.runtime = {
    logging: { level: 'warn', format: 'json' },
    trustProxy: true,
    admin: { enabled: true, tokenSource: 'file' },
  };
  state.adminAuth = { enabled: true, path: '/admin', token: 'runtime-token', tokenSource: 'file' };
  const info = getRuntimeInfo(state);
  assertEquals(info.logging, { level: 'warn', format: 'json' });
  assertEquals(info.trust_proxy, true);
  assertEquals(info.admin, { enabled: true, token_source: 'file' });
  assertEquals(Object.hasOwn(info.admin, 'token'), false);
});

Deno.test('simulatePipeline with empty pipeline returns accept', async () => {
  const result = await simulatePipeline(
    [],
    ['EVENT', { id: 'e1', pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' }],
    { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '127.0.0.1' },
  );
  assertEquals(result.finalAction, 'accept');
  assertEquals(result.steps.length, 0);
});

Deno.test('simulatePipeline with accept policy returns accept step', async () => {
  const result = await simulatePipeline(
    [{ policy: 'accept' }],
    ['EVENT', { id: 'e1', pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' }],
    { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '127.0.0.1' },
  );
  assertEquals(result.finalAction, 'accept');
  assertEquals(result.steps.length, 1);
  assertEquals(result.steps[0].policy, 'accept');
  assertEquals(result.steps[0].action, 'accept');
});

Deno.test('simulatePipeline protected-event follows require_auth config and protected tag', async () => {
  const protectedEvent = ['EVENT', 'sub1', {
    id: 'e1',
    pubkey: 'pk',
    kind: 1,
    created_at: 0,
    tags: [['-']],
    content: '',
    sig: '',
  }];
  const connectionInfo = { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '127.0.0.1' };

  const missingConfig = await simulatePipeline(
    [{ policy: 'protected-event', config: {} }],
    protectedEvent,
    connectionInfo,
  );
  const requireAuth = await simulatePipeline(
    [{ policy: 'protected-event', config: { require_auth: true } }],
    protectedEvent,
    connectionInfo,
  );

  assertEquals(missingConfig.finalAction, 'accept');
  assertEquals(requireAuth.finalAction, 'reject');
});

Deno.test('simulatePipeline protected-event ignores client EVENT shape like runtime policy', async () => {
  const clientEvent = ['EVENT', {
    id: 'e1',
    pubkey: 'pk',
    kind: 1,
    created_at: 0,
    tags: [['-']],
    content: '',
    sig: '',
  }];
  const connectionInfo = { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '127.0.0.1' };

  const result = await simulatePipeline(
    [{ policy: 'protected-event', config: { require_auth: true } }],
    clientEvent,
    connectionInfo,
  );

  assertEquals(result.finalAction, 'accept');
});

Deno.test('simulatePipeline ip-filter follows runtime blocklist schema', async () => {
  const message = ['EVENT', { id: 'e1', pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' }];
  const connectionInfo = { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '1.2.3.4' };

  const legacyConfig = await simulatePipeline(
    [{ policy: 'ip-filter', config: { deny: ['1.2.3.4'] } }],
    message,
    connectionInfo,
  );
  const runtimeConfig = await simulatePipeline(
    [{ policy: 'ip-filter', config: { blocklist: { ips: ['1.2.3.4'] } } }],
    message,
    connectionInfo,
  );

  assertEquals(legacyConfig.finalAction, 'accept');
  assertEquals(runtimeConfig.finalAction, 'reject');
});

Deno.test('simulatePipeline pubkey-acl ignores non-EVENT messages like runtime policy', async () => {
  const result = await simulatePipeline(
    [{ policy: 'pubkey-acl', config: { mode: 'allowlist', target: 'client', pubkeys: ['pk1'] } }],
    ['REQ', 'sub1', { kinds: [1] }],
    { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '127.0.0.1' },
  );

  assertEquals(result.finalAction, 'accept');
});

Deno.test('maskSecrets masks infra.redis.url', () => {
  const state = makeState();
  (state.config as any).infra = { redis: { url: 'redis://secret@localhost:6379' } };
  const masked = maskSecrets(state.config) as any;
  assertEquals(masked.infra.redis.url, '***');
});
