import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { simulatePipeline } from './pipeline_simulator.ts';

Deno.test('admin pipeline simulator follows nested when branches', async () => {
  const result = await simulatePipeline(
    [{
      policy: 'when',
      config: {
        condition: { authenticated: true },
        then: [{ policy: 'accept' }],
        else: [{ policy: 'write-guard', config: { require_auth: true } }],
      },
    }],
    ['EVENT', { id: 'e1', pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' }],
    { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '127.0.0.1' },
  );

  assertEquals(result.finalAction, 'reject');
  assertEquals(result.steps[0].policy, 'when');
  assertEquals(result.steps[0].branch, 'else');
  assertEquals(result.steps[1].policy, 'write-guard');
});

Deno.test('admin pipeline simulator uses runtime ip-filter blocklist schema', async () => {
  const result = await simulatePipeline(
    [{ policy: 'ip-filter', config: { blocklist: { cidrs: ['203.0.113.0/24'] } } }],
    ['EVENT', { id: 'e1', pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' }],
    { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '203.0.113.10' },
  );

  assertEquals(result.finalAction, 'reject');
  assertEquals(result.finalResponse, 'IP is blocked');
});

Deno.test('admin pipeline simulator uses runtime kind-filter mode schema', async () => {
  const result = await simulatePipeline(
    [{ policy: 'kind-filter', config: { mode: 'allow', kinds: [1] } }],
    ['EVENT', { id: 'e1', pubkey: 'pk', kind: 4, created_at: 0, tags: [], content: '', sig: '' }],
    { clientAuthorized: false, clientPubkey: '', connectionIpAddr: '127.0.0.1' },
  );

  assertEquals(result.finalAction, 'reject');
  assertEquals(result.finalResponse, 'kind 4 is not allowed');
});

Deno.test('admin pipeline simulator facade delegates to playground action module', async () => {
  const facade = await import('./pipeline_simulator.ts');
  const action = await import('./actions/playground.ts');

  assertEquals(facade.simulatePipeline, action.simulatePipeline);
});
