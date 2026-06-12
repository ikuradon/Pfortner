import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { getLogs, parseLogLimit } from './logs.ts';
import type { AdminServiceState } from './state.ts';
import { LogBuffer } from '../infra/log-buffer.ts';

function makeState(overrides: Partial<AdminServiceState> = {}): AdminServiceState {
  return {
    config: {
      server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
      pipelines: { client: [], server: [] },
    },
    pluginNames: ['accept'],
    connections: new Map(),
    blocklist: { pubkeys: new Set(), ips: new Set() },
    ...overrides,
  };
}

Deno.test('admin logs service clamps requested log limits', () => {
  assertEquals(parseLogLimit('0'), 1);
  assertEquals(parseLogLimit('100000'), 1000);
  assertEquals(parseLogLimit('bad', 25), 25);
});

Deno.test('admin logs service returns buffered entries and metadata', () => {
  const logBuffer = new LogBuffer(5);
  logBuffer.push('first');
  logBuffer.push('second');

  const result = getLogs(makeState({ logBuffer }), 1);

  assertEquals(result.logs.length, 1);
  assertEquals(result.logs[0].line, 'second');
  assertEquals(result.total, 2);
  assertEquals(result.subscribers, 0);
});

Deno.test('admin logs read model does not create HTTP responses', async () => {
  const readModel = await import('./read_models/logs.ts') as Record<string, unknown>;
  const http = await import('./http/log_stream.ts');

  assertEquals(typeof readModel.getLogs, 'function');
  assertEquals(typeof readModel.createLogStreamResponse, 'undefined');
  assertEquals(typeof http.createLogStreamResponse, 'function');
});
