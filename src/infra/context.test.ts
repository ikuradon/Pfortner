import { assertEquals } from '@std/assert';
import { buildInfraContext } from './context.ts';

Deno.test('buildInfraContext creates context with defaults', () => {
  const ctx = buildInfraContext({});
  assertEquals(typeof ctx.logger.info, 'function');
  assertEquals(typeof ctx.metrics.counter, 'function');
  assertEquals(typeof ctx.httpClient.fetch, 'function');
  assertEquals(ctx.redis, undefined);
  assertEquals(ctx.kv, undefined);
});

Deno.test('buildInfraContext respects logging options', () => {
  const output: string[] = [];
  const ctx = buildInfraContext({
    logging: { format: 'json', level: 'warn' },
    logSink: (line) => output.push(line),
  });
  ctx.logger.info('should be filtered');
  ctx.logger.warn('should appear');
  assertEquals(output.length, 1);
});
