import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { buildInfraContext } from '../infra/context.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import { resolvePipeline } from './pipeline-resolver.ts';

Deno.test('pipeline resolver initializes policy factories for a direction', async () => {
  const resolved = await resolvePipeline(
    [{ policy: 'accept' }],
    'client',
    createPluginRegistry(),
    buildInfraContext({}),
  );

  assertEquals(resolved.direction, 'client');
  assertEquals(resolved.factories.length, 1);
});

Deno.test('pipeline resolver rejects plugins registered for the wrong direction', async () => {
  try {
    await resolvePipeline(
      [{ policy: 'protected-event', config: { require_auth: true } }],
      'client',
      createPluginRegistry(),
      buildInfraContext({}),
    );
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('direction'), true);
  }
});
