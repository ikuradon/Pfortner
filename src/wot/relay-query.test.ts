import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { parseRelayResponse } from './relay-query.ts';

Deno.test('parseRelayResponse extracts contact lists from EVENT messages', () => {
  const messages = [
    [
      'EVENT',
      'sub1',
      { pubkey: 'pk1', kind: 3, tags: [['p', 'a'], ['p', 'b']], id: 'e1', created_at: 0, content: '', sig: '' },
    ],
    ['EVENT', 'sub1', { pubkey: 'pk2', kind: 3, tags: [['p', 'c']], id: 'e2', created_at: 0, content: '', sig: '' }],
    ['EOSE', 'sub1'],
  ];
  const result = parseRelayResponse(messages);
  assertEquals(result.get('pk1'), ['a', 'b']);
  assertEquals(result.get('pk2'), ['c']);
});
