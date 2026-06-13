import { assertEquals } from '@std/assert';
import { createLogger } from './logger.ts';

Deno.test('logger outputs JSON format', () => {
  const output: string[] = [];
  const logger = createLogger({ format: 'json', level: 'info', sink: (line) => output.push(line) });
  logger.info('test message', { connection_id: '123' });
  const parsed = JSON.parse(output[0]);
  assertEquals(parsed.message, 'test message');
  assertEquals(parsed.level, 'info');
  assertEquals(parsed.connection_id, '123');
  assertEquals(typeof parsed.timestamp, 'string');
});

Deno.test('logger outputs text format', () => {
  const output: string[] = [];
  const logger = createLogger({ format: 'text', level: 'info', sink: (line) => output.push(line) });
  logger.info('hello world');
  assertEquals(output[0].includes('INFO'), true);
  assertEquals(output[0].includes('hello world'), true);
});

Deno.test('logger respects level filtering', () => {
  const output: string[] = [];
  const logger = createLogger({ format: 'json', level: 'warn', sink: (line) => output.push(line) });
  logger.debug('should not appear');
  logger.info('should not appear');
  logger.warn('should appear');
  logger.error('should appear');
  assertEquals(output.length, 2);
});
