import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { buildWotGraph, parseContactList } from './builder.ts';

Deno.test('parseContactList extracts p-tag pubkeys', () => {
  const event = {
    id: 'e1',
    pubkey: 'root',
    kind: 3,
    created_at: 0,
    sig: '',
    tags: [['p', 'friend1'], ['p', 'friend2'], ['e', 'ignored']],
    content: '',
  };
  const pubkeys = parseContactList(event);
  assertEquals(pubkeys, ['friend1', 'friend2']);
});

Deno.test('parseContactList returns empty for no p-tags', () => {
  const event = {
    id: 'e1',
    pubkey: 'root',
    kind: 3,
    created_at: 0,
    sig: '',
    tags: [['e', 'something']],
    content: '',
  };
  assertEquals(parseContactList(event), []);
});

Deno.test('buildWotGraph depth 0 returns only root pubkeys', async () => {
  const mockQuery = (_pubkeys: string[]): Promise<Map<string, string[]>> => {
    return Promise.resolve(new Map([['root1', ['a', 'b']], ['root2', ['c']]]));
  };
  const result = await buildWotGraph(['root1', 'root2'], 0, mockQuery);
  assertEquals(result.has('root1'), true);
  assertEquals(result.has('root2'), true);
  assertEquals(result.has('a'), false); // depth 0 = roots only
});

Deno.test('buildWotGraph depth 1 includes direct follows', async () => {
  const mockQuery = (pubkeys: string[]): Promise<Map<string, string[]>> => {
    const result = new Map<string, string[]>();
    for (const pk of pubkeys) {
      if (pk === 'root') result.set('root', ['a', 'b']);
      if (pk === 'a') result.set('a', ['c', 'd']);
      if (pk === 'b') result.set('b', ['e']);
    }
    return Promise.resolve(result);
  };
  const result = await buildWotGraph(['root'], 1, mockQuery);
  assertEquals(result.has('root'), true);
  assertEquals(result.has('a'), true);
  assertEquals(result.has('b'), true);
  assertEquals(result.has('c'), false); // depth 2, not reached
});

Deno.test('buildWotGraph ignores contact lists for pubkeys outside the requested frontier', async () => {
  const mockQuery = (_pubkeys: string[]): Promise<Map<string, string[]>> => {
    return Promise.resolve(new Map([['unrequested-author', ['attacker']]]));
  };

  const result = await buildWotGraph(['root'], 1, mockQuery);
  assertEquals(result.has('root'), true);
  assertEquals(result.has('attacker'), false);
  assertEquals(result.size, 1);
});

Deno.test('buildWotGraph depth 2 follows transitively', async () => {
  const mockQuery = (pubkeys: string[]): Promise<Map<string, string[]>> => {
    const result = new Map<string, string[]>();
    for (const pk of pubkeys) {
      if (pk === 'root') result.set('root', ['a']);
      if (pk === 'a') result.set('a', ['b']);
      if (pk === 'b') result.set('b', ['c']);
    }
    return Promise.resolve(result);
  };
  const result = await buildWotGraph(['root'], 2, mockQuery);
  assertEquals(result.has('root'), true);
  assertEquals(result.has('a'), true);
  assertEquals(result.has('b'), true);
  assertEquals(result.has('c'), false); // depth 3
});

Deno.test('buildWotGraph handles cycles', async () => {
  const mockQuery = (pubkeys: string[]): Promise<Map<string, string[]>> => {
    const result = new Map<string, string[]>();
    for (const pk of pubkeys) {
      if (pk === 'a') result.set('a', ['b']);
      if (pk === 'b') result.set('b', ['a']); // cycle
    }
    return Promise.resolve(result);
  };
  const result = await buildWotGraph(['a'], 5, mockQuery);
  assertEquals(result.has('a'), true);
  assertEquals(result.has('b'), true);
  assertEquals(result.size, 2); // no infinite loop
});
