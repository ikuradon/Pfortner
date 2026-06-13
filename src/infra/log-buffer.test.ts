import { assertEquals } from '@std/assert';
import { LogBuffer } from './log-buffer.ts';

Deno.test('LogBuffer keeps only max entries', () => {
  const buffer = new LogBuffer(2);
  buffer.push('first');
  buffer.push('second');
  buffer.push('third');

  const logs = buffer.list();
  assertEquals(logs.map((entry) => entry.line), ['second', 'third']);
  assertEquals(logs.map((entry) => entry.id), [2, 3]);
  assertEquals(buffer.size(), 2);
});

Deno.test('LogBuffer list applies limit', () => {
  const buffer = new LogBuffer(5);
  buffer.push('a');
  buffer.push('b');
  buffer.push('c');

  assertEquals(buffer.list(2).map((entry) => entry.line), ['b', 'c']);
  assertEquals(buffer.list(0), []);
});

Deno.test('LogBuffer notifies subscribers until unsubscribe', () => {
  const buffer = new LogBuffer(5);
  const received: string[] = [];

  const unsubscribe = buffer.subscribe((entry) => {
    received.push(entry.line);
  });

  buffer.push('one');
  assertEquals(received, ['one']);
  assertEquals(buffer.subscriberCount(), 1);

  unsubscribe();
  buffer.push('two');

  assertEquals(received, ['one']);
  assertEquals(buffer.subscriberCount(), 0);
});
