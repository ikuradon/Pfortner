import { assertEquals } from '@std/assert';
import { contentFilterPlugin } from './ContentFilterPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';
import AjvModule from 'ajv';

// deno-lint-ignore no-explicit-any
const AjvClass = (AjvModule as any).default ?? AjvModule;

const infra = buildInfraContext({});
const mockInstance = (): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: { connectionId: 'test', connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
});
const makeEvent = (content: string, kind = 1) => ({
  id: 'e1',
  pubkey: 'pk',
  kind,
  created_at: 0,
  tags: [],
  content,
  sig: '',
});

Deno.test('contentFilter passes non-EVENT messages', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: ['spam'] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['REQ', 'sub1', {}], inst.connectionInfo)).action, 'next');
});

Deno.test('contentFilter rejects event with blocked word', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: ['spam', 'scam'] }, infra);
  const inst = mockInstance();
  assertEquals(
    (await factory(inst)(['EVENT', makeEvent('this is spam content')], inst.connectionInfo)).action,
    'reject',
  );
});

Deno.test('contentFilter passes clean content', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: ['spam'] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('hello world')], inst.connectionInfo)).action, 'next');
});

Deno.test('contentFilter rejects event matching blocked_patterns', async () => {
  const factory = await contentFilterPlugin.initialize(
    { blocked_patterns: ['https?://malicious\\.example\\.com'] },
    infra,
  );
  const inst = mockInstance();
  assertEquals(
    (await factory(inst)(['EVENT', makeEvent('visit http://malicious.example.com')], inst.connectionInfo)).action,
    'reject',
  );
});

Deno.test('contentFilter apply_to_kinds only filters matching kinds', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: ['spam'], apply_to_kinds: [1] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent('spam', 30023)], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent('spam', 1)], inst.connectionInfo)).action, 'reject');
});

Deno.test('contentFilter works in server direction (3-element EVENT)', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: ['spam'] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['EVENT', 'sub1', makeEvent('spam')], inst.connectionInfo)).action, 'reject');
});

Deno.test('contentFilter blocked_words is case-insensitive', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: ['SPAM'] }, infra);
  const inst = mockInstance();
  assertEquals(
    (await factory(inst)(['EVENT', makeEvent('this has Spam in it')], inst.connectionInfo)).action,
    'reject',
  );
});

Deno.test('contentFilter external_api accepts when API returns ok', async () => {
  const mockInfra = buildInfraContext({});
  // Override httpClient with mock
  mockInfra.httpClient = {
    fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 })),
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'reject' },
  }, mockInfra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent('hello')], inst.connectionInfo);
  assertEquals(result.action, 'next');
});

Deno.test('contentFilter external_api rejects when API returns blocked', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: false }), { status: 200 })),
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'accept' },
  }, mockInfra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent('hello')], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('contentFilter external_api on_error accept passes on API failure', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: () => Promise.reject(new Error('network error')),
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'accept' },
  }, mockInfra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent('hello')], inst.connectionInfo);
  assertEquals(result.action, 'next');
});

Deno.test('contentFilter empty blocked_words array: all events pass', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: [] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('anything goes here')], inst.connectionInfo)).action, 'next');
  assertEquals((await factory(inst)(['EVENT', makeEvent('spam scam phish')], inst.connectionInfo)).action, 'next');
});

Deno.test('contentFilter event.content is empty string: passes word check', async () => {
  const factory = await contentFilterPlugin.initialize({ blocked_words: ['spam'] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('')], inst.connectionInfo)).action, 'next');
});

Deno.test('contentFilter blocked_patterns with invalid regex throws on initialize', async () => {
  let threw = false;
  try {
    await contentFilterPlugin.initialize({ blocked_patterns: ['[invalid(regex'] }, infra);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('contentFilter external_api on_error reject rejects on API failure', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: () => Promise.reject(new Error('network error')),
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'reject' },
  }, mockInfra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent('hello')], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('contentFilter configSchema rejects legacy banned keys', () => {
  const validate = new AjvClass({ allErrors: true }).compile(contentFilterPlugin.configSchema);

  assertEquals(validate({ banned_words: ['spam'] }), false);
  assertEquals(validate({ banned_patterns: ['spam'] }), false);
  assertEquals(
    validate({
      blocked_words: ['spam'],
      blocked_patterns: ['https?://spam\\.example'],
      apply_to_kinds: [1],
      external_api: {
        url: 'https://moderation.example.test/check',
        timeout: 1000,
        on_error: 'reject',
        max_concurrent_requests: 2,
        max_response_bytes: 2048,
      },
    }),
    true,
  );
});

Deno.test('contentFilter external_api bounds concurrent moderation requests', async () => {
  const mockInfra = buildInfraContext({});
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockInfra.httpClient = {
    fetch: async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
      return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    },
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'reject', max_concurrent_requests: 2 },
  }, mockInfra);
  const inst = mockInstance();
  const policy = factory(inst);

  const pending = [
    policy(['EVENT', makeEvent('hello 1')], inst.connectionInfo),
    policy(['EVENT', makeEvent('hello 2')], inst.connectionInfo),
    policy(['EVENT', makeEvent('hello 3')], inst.connectionInfo),
  ];
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(calls, 2);
  assertEquals(maxActive, 2);
  release();
  const results = await Promise.all(pending);
  assertEquals(results.map((result) => result.action), ['next', 'next', 'reject']);
});

Deno.test('contentFilter external_api passes on concurrency limit when on_error accept', async () => {
  const mockInfra = buildInfraContext({});
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockInfra.httpClient = {
    fetch: async () => {
      calls++;
      await gate;
      return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    },
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'accept', max_concurrent_requests: 1 },
  }, mockInfra);
  const inst = mockInstance();
  const policy = factory(inst);

  const first = policy(['EVENT', makeEvent('hello 1')], inst.connectionInfo);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await policy(['EVENT', makeEvent('hello 2')], inst.connectionInfo);

  assertEquals(calls, 1);
  assertEquals(second.action, 'next');
  release();
  assertEquals((await first).action, 'next');
});

Deno.test('contentFilter external_api rejects responses over max_response_bytes when on_error reject', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: true }).padEnd(64, ' '), { status: 200 })),
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'reject', max_response_bytes: 16 },
  }, mockInfra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent('hello')], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('contentFilter external_api rejects unavailable response body when on_error reject', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: () =>
      Promise.resolve({
        body: null,
        json: () => Promise.resolve({ allowed: true }),
      } as Response),
  };
  const factory = await contentFilterPlugin.initialize({
    external_api: { url: 'http://mock/check', timeout: 1000, on_error: 'reject', max_response_bytes: 16 },
  }, mockInfra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent('hello')], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});
