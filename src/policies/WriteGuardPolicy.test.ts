import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { writeGuardPlugin } from './WriteGuardPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const infra = buildInfraContext({});
const makeEvent = (kind = 1) => ({ id: 'e1', pubkey: 'pk', kind, created_at: 0, tags: [], content: '', sig: '' });

const mockInstance = (authorized = false): PfortnerInstance & { _authSent: boolean } => {
  let authSent = false;
  return {
    sendAuthMessage: () => {
      authSent = true;
    },
    sendMessageToClient: async () => {},
    connectionInfo: {
      connectionId: 'test',
      connectionIpAddr: '127.0.0.1',
      clientAuthorized: authorized,
      clientPubkey: authorized ? 'pk' : '',
    },
    get _authSent() {
      return authSent;
    },
  } as PfortnerInstance & { _authSent: boolean };
};

Deno.test('writeGuard passes REQ messages', async () => {
  const factory = await writeGuardPlugin.initialize({ require_auth: true }, infra);
  const inst = mockInstance(false);
  assertEquals((await factory(inst)(['REQ', 'sub1', { kinds: [1] }], inst.connectionInfo)).action, 'next');
});

Deno.test('writeGuard passes CLOSE messages', async () => {
  const factory = await writeGuardPlugin.initialize({ require_auth: true }, infra);
  const inst = mockInstance(false);
  assertEquals((await factory(inst)(['CLOSE', 'sub1'], inst.connectionInfo)).action, 'next');
});

Deno.test('writeGuard rejects EVENT when require_auth and not authed', async () => {
  const factory = await writeGuardPlugin.initialize({ require_auth: true }, infra);
  const inst = mockInstance(false);
  const result = await factory(inst)(['EVENT', makeEvent()], inst.connectionInfo);
  assertEquals(result.action, 'reject');
  assertEquals(inst._authSent, true);
});

Deno.test('writeGuard passes EVENT when authed', async () => {
  const factory = await writeGuardPlugin.initialize({ require_auth: true }, infra);
  const inst = mockInstance(true);
  assertEquals((await factory(inst)(['EVENT', makeEvent()], inst.connectionInfo)).action, 'next');
});

Deno.test('writeGuard rejects all EVENTs in read_only_mode', async () => {
  const factory = await writeGuardPlugin.initialize({ read_only_mode: true }, infra);
  const inst = mockInstance(true);
  assertEquals((await factory(inst)(['EVENT', makeEvent()], inst.connectionInfo)).action, 'reject');
});

Deno.test('writeGuard allowed_kinds restricts even authed users', async () => {
  const factory = await writeGuardPlugin.initialize({ require_auth: true, allowed_kinds: [1, 7] }, infra);
  const inst = mockInstance(true);
  assertEquals((await factory(inst)(['EVENT', makeEvent(30023)], inst.connectionInfo)).action, 'reject');
});

Deno.test('writeGuard read_only_mode takes priority over require_auth', async () => {
  // read_only_mode: true AND require_auth: true — read_only_mode wins, no auth challenge sent
  const factory = await writeGuardPlugin.initialize({ read_only_mode: true, require_auth: true }, infra);
  const inst = mockInstance(false);
  const result = await factory(inst)(['EVENT', makeEvent()], inst.connectionInfo);
  assertEquals(result.action, 'reject');
  // Should not send auth challenge because read_only_mode is checked first
  assertEquals(inst._authSent, false);
});

Deno.test('writeGuard empty allowed_kinds: all EVENTs rejected for authenticated users', async () => {
  const factory = await writeGuardPlugin.initialize({ require_auth: true, allowed_kinds: [] }, infra);
  const inst = mockInstance(true);
  assertEquals((await factory(inst)(['EVENT', makeEvent(1)], inst.connectionInfo)).action, 'reject');
  assertEquals((await factory(inst)(['EVENT', makeEvent(4)], inst.connectionInfo)).action, 'reject');
  assertEquals((await factory(inst)(['EVENT', makeEvent(30023)], inst.connectionInfo)).action, 'reject');
});

Deno.test('writeGuard no config (all defaults): all messages pass through', async () => {
  const factory = await writeGuardPlugin.initialize({}, infra);
  const inst = mockInstance(false);
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent()], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['REQ', 'sub1', {}], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['CLOSE', 'sub1'], inst.connectionInfo)).action, 'next');
});

Deno.test('writeGuard sends AUTH challenge only once', async () => {
  const factory = await writeGuardPlugin.initialize({ require_auth: true }, infra);
  let authCount = 0;
  const inst: PfortnerInstance = {
    sendAuthMessage: () => {
      authCount++;
    },
    sendMessageToClient: async () => {},
    connectionInfo: { connectionId: 'test', connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
  };
  const policy = factory(inst);
  await policy(['EVENT', makeEvent()], inst.connectionInfo);
  await policy(['EVENT', makeEvent()], inst.connectionInfo);
  await policy(['EVENT', makeEvent()], inst.connectionInfo);
  assertEquals(authCount, 1);
});
