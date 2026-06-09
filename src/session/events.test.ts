import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createSocketEventBus } from './events.ts';

Deno.test('socket event bus calls listeners in order and keeps later listeners after failures', async () => {
  const calls: string[] = [];
  const bus = createSocketEventBus(() => 'conn-1');

  bus.on('clientMsg', () => {
    calls.push('first');
    throw new Error('listener failed');
  });
  bus.on('clientMsg', (message: string) => {
    calls.push(`second:${message}`);
  });

  await bus.emit('clientMsg', 'hello');

  assertEquals(calls, ['first', 'second:hello']);
});

Deno.test('socket event bus removes listeners and clears all listeners', async () => {
  const calls: string[] = [];
  const bus = createSocketEventBus(() => 'conn-1');
  const listener = () => {
    calls.push('called');
  };

  bus.on('clientConnect', listener);
  bus.off('clientConnect', listener);
  await bus.emit('clientConnect');
  bus.on('clientConnect', listener);
  bus.clear();
  await bus.emit('clientConnect');

  assertEquals(calls, []);
});
