import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createPluginRegistry } from './registry.ts';

Deno.test('registry resolves accept plugin', () => {
  assertEquals(createPluginRegistry().resolve('accept').name, 'accept');
});
Deno.test('registry resolves kind-filter', () => {
  assertEquals(createPluginRegistry().resolve('kind-filter').name, 'kind-filter');
});
Deno.test('registry resolves write-guard', () => {
  assertEquals(createPluginRegistry().resolve('write-guard').name, 'write-guard');
});
Deno.test('registry resolves protected-event', () => {
  assertEquals(createPluginRegistry().resolve('protected-event').name, 'protected-event');
});
Deno.test('registry throws for unknown plugin', () => {
  try {
    createPluginRegistry().resolve('nonexistent');
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('nonexistent'), true);
  }
});
