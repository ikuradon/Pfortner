import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createRelayQueryFn, parseRelayResponse } from './relay-query.ts';
import { nostrTools } from '../deps.ts';

function makeContactListEvent(
  pubkeySk: Uint8Array,
  tags: string[][],
  createdAt = 0,
): nostrTools.VerifiedEvent {
  return nostrTools.finalizeEvent({ kind: 3, content: '', created_at: createdAt, tags }, pubkeySk);
}

Deno.test('parseRelayResponse extracts contact lists from EVENT messages', () => {
  const sk1 = nostrTools.generateSecretKey();
  const sk2 = nostrTools.generateSecretKey();
  const event1 = makeContactListEvent(sk1, [['p', 'a'], ['p', 'b']]);
  const event2 = makeContactListEvent(sk2, [['p', 'c']]);

  const messages = [
    ['EVENT', 'sub1', event1],
    ['EVENT', 'sub1', event2],
    ['EOSE', 'sub1'],
  ];

  const result = parseRelayResponse(messages, 'sub1', new Set([event1.pubkey, event2.pubkey]));
  assertEquals(result.get(event1.pubkey), ['a', 'b']);
  assertEquals(result.get(event2.pubkey), ['c']);
});

Deno.test('parseRelayResponse ignores forged or unsolicited EVENT messages', () => {
  const sk = nostrTools.generateSecretKey();
  const validEvent = makeContactListEvent(sk, [['p', 'trusted-follow']]);
  const forgedEvent = { ...validEvent, sig: '0'.repeat(128) };

  const messages = [
    ['EVENT', 'other-sub', validEvent],
    ['EVENT', 'sub1', { ...validEvent, pubkey: nostrTools.getPublicKey(nostrTools.generateSecretKey()) }],
    ['EVENT', 'sub1', forgedEvent],
    ['EVENT', 'sub1', validEvent],
  ];

  const result = parseRelayResponse(messages, 'sub1', new Set([validEvent.pubkey]));
  assertEquals(result.size, 1);
  assertEquals(result.get(validEvent.pubkey), ['trusted-follow']);
});

Deno.test('parseRelayResponse ignores malformed EVENT payloads', () => {
  const sk = nostrTools.generateSecretKey();
  const validEvent = makeContactListEvent(sk, [['p', 'trusted-follow']]);
  const messages = [
    ['EVENT', 'sub1', null],
    ['EVENT', 'sub1', { pubkey: validEvent.pubkey, kind: 3, tags: 'not-tags' }],
    ['EVENT', 'sub1', validEvent],
  ];

  const result = parseRelayResponse(messages, 'sub1', new Set([validEvent.pubkey]));
  assertEquals(result, new Map([[validEvent.pubkey, ['trusted-follow']]]));
});

Deno.test('parseRelayResponse ignores EVENT payloads that throw during validation', () => {
  const sk = nostrTools.generateSecretKey();
  const validEvent = makeContactListEvent(sk, [['p', 'trusted-follow']]);
  const throwingEvent = {
    id: validEvent.id,
    pubkey: validEvent.pubkey,
    kind: 3,
    created_at: validEvent.created_at,
    content: validEvent.content,
    sig: validEvent.sig,
    get tags(): string[][] {
      throw new Error('malformed tags');
    },
  };
  const messages = [
    ['EVENT', 'sub1', throwingEvent],
    ['EVENT', 'sub1', validEvent],
  ];

  const result = parseRelayResponse(messages, 'sub1', new Set([validEvent.pubkey]));
  assertEquals(result, new Map([[validEvent.pubkey, ['trusted-follow']]]));
});

Deno.test('parseRelayResponse keeps the newest contact list for duplicate pubkeys', () => {
  const sk = nostrTools.generateSecretKey();
  const newerEvent = makeContactListEvent(sk, [['p', 'newer-follow']], 2);
  const olderEvent = makeContactListEvent(sk, [['p', 'older-follow']], 1);
  const messages = [
    ['EVENT', 'sub1', newerEvent],
    ['EVENT', 'sub1', olderEvent],
  ];

  const result = parseRelayResponse(messages, 'sub1', new Set([newerEvent.pubkey]));
  assertEquals(result.get(newerEvent.pubkey), ['newer-follow']);
});

Deno.test('createRelayQueryFn resolves when CLOSE send throws after EOSE', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sk = nostrTools.generateSecretKey();
  const contactList = makeContactListEvent(sk, [['p', 'trusted-follow']]);

  class ThrowingCloseWebSocket {
    #listeners = new Map<string, ((event: { data?: string }) => void)[]>();

    constructor(_url: string) {
      setTimeout(() => this.#dispatch('open', {}), 0);
    }

    addEventListener(type: string, listener: (event: { data?: string }) => void): void {
      const listeners = this.#listeners.get(type) ?? [];
      listeners.push(listener);
      this.#listeners.set(type, listeners);
    }

    send(data: string): void {
      const message = JSON.parse(data);
      if (message[0] === 'CLOSE') {
        throw new Error('relay close send failed');
      }
      const subId = message[1];
      setTimeout(() => {
        this.#dispatch('message', { data: JSON.stringify(['EVENT', subId, contactList]) });
        this.#dispatch('message', { data: JSON.stringify(['EOSE', subId]) });
      }, 0);
    }

    close(): void {}

    #dispatch(type: string, event: { data?: string }): void {
      for (const listener of this.#listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  try {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: ThrowingCloseWebSocket,
    });
    const queryFn = createRelayQueryFn('wss://example.invalid', 500);
    const result = await Promise.race([
      queryFn([contactList.pubkey]),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);

    assertEquals(result, new Map([[contactList.pubkey, ['trusted-follow']]]));
  } finally {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket,
    });
  }
});
