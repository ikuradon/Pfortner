import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { acceptPolicy } from './AcceptPolicy.ts';

const connectionInfo = {
  connectionId: 'test-id',
  connectionIpAddr: '127.0.0.1',
  clientAuthorized: false,
  clientPubkey: '',
};

Deno.test('acceptPolicy returns accept for EVENT message', async () => {
  const message = ['EVENT', { id: 'test', pubkey: 'abc', kind: 1, created_at: 0, tags: [], content: '', sig: '' }];
  const result = await acceptPolicy(message, connectionInfo);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});

Deno.test('acceptPolicy returns accept for REQ message', async () => {
  const message = ['REQ', 'sub1', { kinds: [1] }];
  const result = await acceptPolicy(message, connectionInfo);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});

Deno.test('acceptPolicy returns accept for CLOSE message', async () => {
  const message = ['CLOSE', 'sub1'];
  const result = await acceptPolicy(message, connectionInfo);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});

Deno.test('acceptPolicy returns accept for empty message', async () => {
  const message: unknown[] = [];
  const result = await acceptPolicy(message, connectionInfo);
  assertEquals(result.action, 'accept');
  assertEquals(result.message, message);
});
