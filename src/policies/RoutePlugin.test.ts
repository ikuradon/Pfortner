// src/policies/RoutePlugin.test.ts
import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { routePlugin } from './RoutePlugin.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { InfraContext, PfortnerInstance } from '../plugins/types.ts';
import AjvModule from 'ajv';

// deno-lint-ignore no-explicit-any
const AjvClass = (AjvModule as any).default ?? AjvModule;

const mockInstance = (): PfortnerInstance & { relayedMessages: unknown[][]; sentMessages: string[] } => {
  const relayedMessages: unknown[][] = [];
  const sentMessages: string[] = [];
  return {
    sendAuthMessage: () => {},
    sendMessageToClient: (msg) => {
      sentMessages.push(msg);
      return Promise.resolve();
    },
    relayServerMessageToClient: (msg) => {
      relayedMessages.push(msg);
      return Promise.resolve();
    },
    connectionInfo: {
      connectionId: 'test-conn',
      connectionIpAddr: '127.0.0.1',
      clientAuthorized: false,
      clientPubkey: '',
    },
    relayedMessages,
    sentMessages,
  };
};

// Mock infra with a fake upstreamPool that doesn't actually connect
function createMockInfra(): InfraContext {
  const infra = buildInfraContext({});
  // We can't test actual WebSocket routing without a server
  // Test the condition evaluation and subId tracking logic
  return { ...infra, currentDirection: 'client' as const };
}

Deno.test('routePlugin passes non-REQ messages with next', async () => {
  const infra = createMockInfra();
  const factory = await routePlugin.initialize({
    upstream: 'ws://search.example.com',
    condition: { has_search: true },
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  const result = await policy(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo);
  assertEquals(result.action, 'next');
});

Deno.test('routePlugin passes REQ not matching condition with next', async () => {
  const infra = createMockInfra();
  const factory = await routePlugin.initialize({
    upstream: 'ws://search.example.com',
    condition: { has_search: true },
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  // REQ without search field
  const result = await policy(['REQ', 'sub1', { kinds: [1] }], inst.connectionInfo);
  assertEquals(result.action, 'next');
});

Deno.test('routePlugin passes CLOSE for untracked subId with next', async () => {
  const infra = createMockInfra();
  const factory = await routePlugin.initialize({
    upstream: 'ws://search.example.com',
    condition: { has_search: true },
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  const result = await policy(['CLOSE', 'untracked-sub'], inst.connectionInfo);
  assertEquals(result.action, 'next');
});

Deno.test('routePlugin configSchema requires upstream and condition', () => {
  assertEquals(routePlugin.configSchema.required, ['upstream', 'condition']);
});

Deno.test('routePlugin configSchema rejects invalid condition shapes', () => {
  const validate = new AjvClass({ allErrors: true }).compile(routePlugin.configSchema);

  assertEquals(
    validate({
      upstream: 'ws://search.example.com',
      condition: { authenticated: true, or: [{ has_search: true }] },
    }),
    false,
  );
  assertEquals(
    validate({
      upstream: 'ws://search.example.com',
      condition: {},
    }),
    false,
  );
  assertEquals(
    validate({
      upstream: 'ws://search.example.com',
      condition: { serach: true },
    }),
    false,
  );
});

Deno.test('routePlugin direction is client', () => {
  assertEquals(routePlugin.direction, 'client');
});

Deno.test('routePlugin REQ matching condition with mock upstreamPool: subscribe is called, returns reject', async () => {
  const infra = buildInfraContext({});

  let subscribeCalled = false;
  const mockPool = {
    getConnection: (_url: string) =>
      Promise.resolve({
        subscribe: (
          _connectionId: string,
          _subId: string,
          _filters: unknown[],
          _onEvent: unknown,
          _onEose: unknown,
          _onClosed: unknown,
        ) => {
          subscribeCalled = true;
        },
        unsubscribe: (_connectionId: string, _subId: string) => {},
      }),
    notifyClientDisconnect: (_clientId: string) => {},
    closeAll: () => {},
  };

  const infraWithPool = { ...infra, upstreamPool: mockPool };

  const factory = await routePlugin.initialize({
    upstream: 'ws://search.example.com',
    condition: { has_search: true },
  }, infraWithPool);
  const inst = mockInstance();
  const policy = factory(inst);

  // REQ with search field — matches has_search condition
  const result = await policy(['REQ', 'sub1', { search: 'hello' }], inst.connectionInfo);
  assertEquals(result.action, 'reject');
  assertEquals(subscribeCalled, true);
});

Deno.test('routePlugin relays routed upstream responses through server pipeline hook', async () => {
  const infra = buildInfraContext({});

  let onEvent: ((subId: string, event: unknown) => void) | undefined;
  let onEose: ((subId: string) => void) | undefined;
  let onClosed: ((subId: string, message: string) => void) | undefined;
  const mockPool = {
    getConnection: (_url: string) =>
      Promise.resolve({
        subscribe: (
          _connectionId: string,
          _subId: string,
          _filters: unknown[],
          eventCallback: (subId: string, event: unknown) => void,
          eoseCallback: (subId: string) => void,
          closedCallback: (subId: string, message: string) => void,
        ) => {
          onEvent = eventCallback;
          onEose = eoseCallback;
          onClosed = closedCallback;
        },
        unsubscribe: (_connectionId: string, _subId: string) => {},
      }),
    notifyClientDisconnect: (_clientId: string) => {},
    closeAll: () => {},
  };

  const factory = await routePlugin.initialize({
    upstream: 'ws://search.example.com',
    condition: { has_search: true },
  }, { ...infra, upstreamPool: mockPool });
  const inst = mockInstance();
  const policy = factory(inst);

  const result = await policy(['REQ', 'sub1', { search: 'hello' }], inst.connectionInfo);
  assertEquals(result.action, 'reject');

  const event = { id: 'e1', kind: 1, tags: [['-']], content: 'secret' };
  onEvent?.('sub1', event);
  onEose?.('sub1');
  onClosed?.('sub1', 'closed: test');
  await Promise.resolve();

  assertEquals(inst.sentMessages, []);
  assertEquals(inst.relayedMessages, [
    ['EVENT', 'sub1', event],
    ['EOSE', 'sub1'],
    ['CLOSED', 'sub1', 'closed: test'],
  ]);
});
