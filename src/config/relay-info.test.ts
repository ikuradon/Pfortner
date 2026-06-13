import { assertEquals } from '@std/assert';
import { buildRelayInfo } from './relay-info.ts';
import type { PfortnerConfig } from './loader.ts';

const makeConfig = (overrides: Partial<PfortnerConfig> = {}): PfortnerConfig => ({
  server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
  pipelines: { client: [{ policy: 'accept' }], server: [{ policy: 'accept' }] },
  ...overrides,
});

Deno.test('buildRelayInfo includes basic fields from config', () => {
  const info = buildRelayInfo(makeConfig({
    relay_info: { name: 'My Relay', description: 'Test', contact: 'admin@test.com', software: 'pfortner' },
  }));
  assertEquals(info.name, 'My Relay');
  assertEquals(info.description, 'Test');
  assertEquals(info.contact, 'admin@test.com');
  assertEquals(info.software, 'pfortner');
});

Deno.test('buildRelayInfo always includes NIP-01 and NIP-42', () => {
  const info = buildRelayInfo(makeConfig());
  assertEquals(info.supported_nips.includes(1), true);
  assertEquals(info.supported_nips.includes(42), true);
});

Deno.test('buildRelayInfo detects NIP-13 from spam-filter with min_pow', () => {
  const info = buildRelayInfo(makeConfig({
    pipelines: {
      client: [{ policy: 'spam-filter', config: { min_pow: 20 } }, { policy: 'accept' }],
      server: [{ policy: 'accept' }],
    },
  }));
  assertEquals(info.supported_nips.includes(13), true);
  assertEquals(info.limitation?.min_pow_difficulty, 20);
});

Deno.test('buildRelayInfo detects NIP-70 from protected-event', () => {
  const info = buildRelayInfo(makeConfig({
    pipelines: {
      client: [{ policy: 'accept' }],
      server: [{ policy: 'protected-event', config: { require_auth: true } }, { policy: 'accept' }],
    },
  }));
  assertEquals(info.supported_nips.includes(70), true);
});

Deno.test('buildRelayInfo detects auth_required from write-guard', () => {
  const info = buildRelayInfo(makeConfig({
    auth: { enabled: true },
    pipelines: {
      client: [{ policy: 'write-guard', config: { require_auth: true } }, { policy: 'accept' }],
      server: [{ policy: 'accept' }],
    },
  }));
  assertEquals(info.limitation?.auth_required, true);
});

Deno.test('buildRelayInfo detects max_content_length from spam-filter', () => {
  const info = buildRelayInfo(makeConfig({
    pipelines: {
      client: [{ policy: 'spam-filter', config: { max_content_length: 5000 } }, { policy: 'accept' }],
      server: [{ policy: 'accept' }],
    },
  }));
  assertEquals(info.limitation?.max_content_length, 5000);
});
