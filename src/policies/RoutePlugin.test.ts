// src/policies/RoutePlugin.test.ts
import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { routePlugin } from './RoutePlugin.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { InfraContext, PfortnerInstance } from '../plugins/types.ts';

const mockInstance = (): PfortnerInstance & { sentMessages: string[] } => {
  const sentMessages: string[] = [];
  return {
    sendAuthMessage: () => {},
    sendMessageToClient: (msg) => {
      sentMessages.push(msg);
      return Promise.resolve();
    },
    connectionInfo: {
      connectionId: 'test-conn',
      connectionIpAddr: '127.0.0.1',
      clientAuthorized: false,
      clientPubkey: '',
    },
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

Deno.test('routePlugin direction is client', () => {
  assertEquals(routePlugin.direction, 'client');
});
