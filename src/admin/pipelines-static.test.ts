import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.18';
import { buildYamlPreview, defaultConfigForPolicy } from '../../admin/static/pipelines.js';

Deno.test('pipeline editor defaults protected-event to require authentication', () => {
  assertEquals(defaultConfigForPolicy('protected-event'), { require_auth: true });
});

Deno.test('pipeline editor defaults ip-filter to runtime blacklist schema', () => {
  const config = defaultConfigForPolicy('ip-filter') as Record<string, unknown>;
  assertEquals(config, { blacklist: { ips: [], cidrs: [] } });
});

Deno.test('pipeline editor YAML preview includes protected-event config', () => {
  const yaml = buildYamlPreview({
    client: [],
    server: [{ policy: 'protected-event', config: defaultConfigForPolicy('protected-event') }],
  });

  assertStringIncludes(yaml, '- policy: protected-event');
  assertStringIncludes(yaml, 'require_auth: true');
});

Deno.test('pipeline editor YAML preview serializes ip-filter blacklist schema', () => {
  const yaml = buildYamlPreview({
    client: [{ policy: 'ip-filter', config: defaultConfigForPolicy('ip-filter') }],
    server: [],
  });

  assertStringIncludes(yaml, '- policy: ip-filter');
  assertStringIncludes(yaml, 'blacklist:');
  assertStringIncludes(yaml, 'ips: []');
  assertStringIncludes(yaml, 'cidrs: []');
});
