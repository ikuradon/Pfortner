import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { whenPlugin } from './WhenPlugin.ts';
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

// Mock pipelineResolver that creates simple accept/reject policies
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

Deno.test('when: true condition runs then pipeline', async () => {
  const infra = createMockInfra({ accept: 'accept' });
  const factory = await whenPlugin.initialize({
    condition: { authenticated: true },
    then: [{ policy: 'accept' }],
  }, infra);
  const inst = mockInstance(true);
  const policy = factory(inst);
  const result = await policy(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo);
  assertEquals(result.action, 'accept');
});

Deno.test('when: false condition runs else pipeline', async () => {
  const infra = createMockInfra({ reject: 'reject' });
  const factory = await whenPlugin.initialize({
    condition: { authenticated: true },
    then: [{ policy: 'accept' }],
    else: [{ policy: 'reject' }],
  }, infra);
  const inst = mockInstance(false);
  const policy = factory(inst);
  const result = await policy(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('when: false condition without else returns next', async () => {
  const infra = createMockInfra({ accept: 'accept' });
  const factory = await whenPlugin.initialize({
    condition: { authenticated: true },
    then: [{ policy: 'accept' }],
  }, infra);
  const inst = mockInstance(false);
  const policy = factory(inst);
  const result = await policy(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo);
  assertEquals(result.action, 'next');
});

Deno.test('when: condition with message_type', async () => {
  const infra = createMockInfra({ accept: 'accept', reject: 'reject' });
  const factory = await whenPlugin.initialize({
    condition: { message_type: 'EVENT' },
    then: [{ policy: 'accept' }],
    else: [{ policy: 'reject' }],
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo)).action, 'accept');
  assertEquals((await policy(['REQ', 'sub1', {}], inst.connectionInfo)).action, 'reject');
});

Deno.test('when: condition with event_kind', async () => {
  const infra = createMockInfra({ accept: 'accept', reject: 'reject' });
  const factory = await whenPlugin.initialize({
    condition: { event_kind: 4 },
    then: [{ policy: 'reject' }],
    else: [{ policy: 'accept' }],
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', { id: 'e1', kind: 4 }], inst.connectionInfo)).action, 'reject');
  assertEquals((await policy(['EVENT', { id: 'e1', kind: 1 }], inst.connectionInfo)).action, 'accept');
});

Deno.test('when: mixed auth and logical condition does not bypass to then pipeline', async () => {
  const infra = createMockInfra({ accept: 'accept', reject: 'reject' });
  const factory = await whenPlugin.initialize({
    condition: { authenticated: true, or: [{ event_kind: 4 }, { event_kind: 1059 }] },
    then: [{ policy: 'accept' }],
    else: [{ policy: 'reject' }],
  }, infra);
  const inst = mockInstance(false);
  const policy = factory(inst);
  const result = await policy(['EVENT', { id: 'e1', kind: 4 }], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('when: configSchema rejects invalid condition shapes', () => {
  const validate = new AjvClass({ allErrors: true }).compile(whenPlugin.configSchema);

  assertEquals(
    validate({
      condition: { authenticated: true, or: [{ event_kind: 4 }] },
      then: [{ policy: 'accept' }],
    }),
    false,
  );
  assertEquals(
    validate({
      condition: {},
      then: [{ policy: 'accept' }],
    }),
    false,
  );
  assertEquals(
    validate({
      condition: { event_king: 4 },
      then: [{ policy: 'accept' }],
    }),
    false,
  );
});
