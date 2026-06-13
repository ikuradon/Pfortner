import { assertEquals } from '@std/assert';
import { runPolicyPipeline } from './pipeline-runner.ts';
import type { ConnectionInfo, Policy } from '../pfortner.ts';

const connectionInfo: ConnectionInfo = {
  connectionId: 'conn-1',
  connectionIpAddr: '127.0.0.1',
  clientAuthorized: false,
  clientPubkey: '',
};

Deno.test('policy pipeline runner forwards first accepted message', async () => {
  const sent: string[] = [];
  const accept: Policy = (message) => ({ action: 'accept', message });

  await runPolicyPipeline([accept], ['REQ', 'sub'], connectionInfo, {
    sendAccepted: (message: string) => {
      sent.push(message);
      return Promise.resolve();
    },
    sendRejected: () => Promise.resolve(),
  });

  assertEquals(sent, [JSON.stringify(['REQ', 'sub'])]);
});

Deno.test('policy pipeline runner sends rejection response and stops', async () => {
  const sent: string[] = [];
  const reject: Policy = () => ({ action: 'reject', message: [], response: 'blocked' });
  const accept: Policy = (message) => ({ action: 'accept', message });

  await runPolicyPipeline([reject, accept], ['EVENT', {}], connectionInfo, {
    sendAccepted: (message: string) => {
      sent.push(`accepted:${message}`);
      return Promise.resolve();
    },
    sendRejected: (message: string) => {
      sent.push(`rejected:${message}`);
      return Promise.resolve();
    },
  });

  assertEquals(sent, ['rejected:blocked']);
});

Deno.test('policy pipeline runner reports final accept and reject actions', async () => {
  const actions: Array<{ action: 'accept' | 'reject'; message: unknown[] }> = [];
  const accept: Policy = (message) => ({ action: 'accept', message });
  const reject: Policy = (message) => ({ action: 'reject', message });

  await runPolicyPipeline([accept], ['REQ', 'sub'], connectionInfo, {
    sendAccepted: () => Promise.resolve(),
    sendRejected: () => Promise.resolve(),
    onResult: (action, message) => actions.push({ action, message }),
  });

  await runPolicyPipeline([reject], ['EVENT', { id: 'e1' }], connectionInfo, {
    sendAccepted: () => Promise.resolve(),
    sendRejected: () => Promise.resolve(),
    onResult: (action, message) => actions.push({ action, message }),
  });

  assertEquals(actions, [
    { action: 'accept', message: ['REQ', 'sub'] },
    { action: 'reject', message: ['EVENT', { id: 'e1' }] },
  ]);
});
