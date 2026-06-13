import { assertEquals } from '@std/assert';
import type { PfortnerInstance, PolicyFactory, PolicyPlugin } from './types.ts';
import { extractEvent } from './types.ts';

Deno.test('extractEvent handles client direction (length 2)', () => {
  const event = { id: 'e1', kind: 1 };
  const result = extractEvent(['EVENT', event]);
  assertEquals(result?.event, event);
  assertEquals(result?.subscriptionId, undefined);
});

Deno.test('extractEvent handles server direction (length 3)', () => {
  const event = { id: 'e1', kind: 1 };
  const result = extractEvent(['EVENT', 'sub1', event]);
  assertEquals(result?.event, event);
  assertEquals(result?.subscriptionId, 'sub1');
});

Deno.test('extractEvent returns null for non-EVENT', () => {
  assertEquals(extractEvent(['REQ', 'sub1', {}]), null);
  assertEquals(extractEvent(['CLOSE', 'sub1']), null);
});

Deno.test('PolicyPlugin interface is structurally valid', () => {
  const mockPlugin: PolicyPlugin = {
    name: 'test',
    description: 'test plugin',
    direction: 'both',
    configSchema: { type: 'object' },
    initialize: (_config, _infra) => {
      const factory: PolicyFactory = (instance: PfortnerInstance) => {
        return (message, _connectionInfo) => {
          void instance.connectionInfo;
          return { message, action: 'accept' };
        };
      };
      return Promise.resolve(factory);
    },
  };
  assertEquals(mockPlugin.name, 'test');
  assertEquals(mockPlugin.direction, 'both');
});
