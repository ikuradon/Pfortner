import { assertEquals } from '@std/assert';
import { buildInfraContext } from '../infra/context.ts';
import { createPrometheusMetrics } from '../infra/prometheus.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import type { ConnectionInfo } from '../pfortner.ts';
import type { PfortnerInstance } from '../plugins/types.ts';
import { resolvePipeline } from './pipeline-resolver.ts';

function makeConnectionInfo(): ConnectionInfo {
  return {
    connectionId: 'conn-1',
    connectionIpAddr: '127.0.0.1',
    clientAuthorized: false,
    clientPubkey: '',
  };
}

function makeInstance(): PfortnerInstance {
  return {
    sendAuthMessage: () => {},
    sendMessageToClient: () => Promise.resolve(),
    connectionInfo: makeConnectionInfo(),
  };
}

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

Deno.test('pipeline resolver instruments resolved policy decisions', async () => {
  const metrics = createPrometheusMetrics();
  const resolved = await resolvePipeline(
    [{ policy: 'accept' }],
    'client',
    createPluginRegistry(),
    buildInfraContext({ metrics }),
  );

  const policy = resolved.factories[0](makeInstance());
  await policy(['EVENT', {}], makeConnectionInfo());

  assertEquals(
    metrics.render().includes(
      'pfortner_policy_decisions_total{direction="client",policy="accept",action="accept"} 1',
    ),
    true,
  );
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
