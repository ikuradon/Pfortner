import { assertEquals } from '@std/assert';
import { matchPlugin } from './MatchPlugin.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { InfraContext, PfortnerInstance, PolicyFactory } from '../plugins/types.ts';
import AjvModule from 'ajv';

// deno-lint-ignore no-explicit-any
const AjvClass = (AjvModule as any).default ?? AjvModule;

const mockInstance = (authorized = false): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: {
    connectionId: 'test',
    connectionIpAddr: '127.0.0.1',
    clientAuthorized: authorized,
    clientPubkey: authorized ? 'pk1' : '',
  },
});

function createMockInfra(resolverMap: Record<string, string>): InfraContext {
  const infra = buildInfraContext({});
  infra.currentDirection = 'client';
  infra.pipelineResolver = (entries) => {
    return Promise.resolve(
      entries.map((entry): PolicyFactory => {
        const action = resolverMap[entry.policy] ?? 'next';
        return (_instance) => (message) => ({ message, action: action as 'accept' | 'reject' | 'next' });
      }),
    );
  };
  return infra;
}

Deno.test('match: first matching case is executed', async () => {
  const infra = createMockInfra({ accept: 'accept', reject: 'reject' });
  const factory = await matchPlugin.initialize({
    cases: [
      { condition: { event_kind: 4 }, pipeline: [{ policy: 'reject' }] },
      { condition: { event_kind: 1 }, pipeline: [{ policy: 'accept' }] },
    ],
  }, infra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo);
  assertEquals(result.action, 'accept');
});

Deno.test('match: no match runs default', async () => {
  const infra = createMockInfra({ accept: 'accept', reject: 'reject' });
  const factory = await matchPlugin.initialize({
    cases: [
      { condition: { event_kind: 4 }, pipeline: [{ policy: 'reject' }] },
    ],
    default: [{ policy: 'accept' }],
  }, infra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo);
  assertEquals(result.action, 'accept');
});

Deno.test('match: no match and no default returns next', async () => {
  const infra = createMockInfra({ reject: 'reject' });
  const factory = await matchPlugin.initialize({
    cases: [
      { condition: { event_kind: 4 }, pipeline: [{ policy: 'reject' }] },
    ],
  }, infra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo);
  assertEquals(result.action, 'next');
});

Deno.test('match: complex condition with and/not', async () => {
  const infra = createMockInfra({ accept: 'accept', reject: 'reject' });
  const factory = await matchPlugin.initialize({
    cases: [
      {
        condition: { and: [{ authenticated: true }, { not: { event_kind: 4 } }] },
        pipeline: [{ policy: 'accept' }],
      },
    ],
    default: [{ policy: 'reject' }],
  }, infra);
  const inst = mockInstance(true);
  assertEquals((await factory(inst)(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo)).action, 'accept');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1', kind: 4 }], inst.connectionInfo)).action, 'reject');
});

Deno.test('match: mixed auth and logical condition does not bypass to matching case', async () => {
  const infra = createMockInfra({ accept: 'accept', reject: 'reject' });
  const factory = await matchPlugin.initialize({
    cases: [
      {
        condition: { authenticated: true, or: [{ event_kind: 4 }, { event_kind: 1059 }] },
        pipeline: [{ policy: 'accept' }],
      },
    ],
    default: [{ policy: 'reject' }],
  }, infra);
  const inst = mockInstance(false);
  const result = await factory(inst)(['EVENT', { id: 'e1', kind: 4 }], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('match: configSchema rejects invalid condition shapes', () => {
  const validate = new AjvClass({ allErrors: true }).compile(matchPlugin.configSchema);

  assertEquals(
    validate({
      cases: [
        { condition: { authenticated: true, or: [{ event_kind: 4 }] }, pipeline: [{ policy: 'accept' }] },
      ],
    }),
    false,
  );
  assertEquals(
    validate({
      cases: [
        { condition: {}, pipeline: [{ policy: 'accept' }] },
      ],
    }),
    false,
  );
  assertEquals(
    validate({
      cases: [
        { condition: { event_king: 4 }, pipeline: [{ policy: 'accept' }] },
      ],
    }),
    false,
  );
});
