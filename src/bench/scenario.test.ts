import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { parseScenario } from './scenario.ts';

const MINIMAL_YAML = `
target: "ws://localhost:3000"
scenarios:
  - name: "basic"
    duration: 10
    connections:
      target: 5
`;

Deno.test('parseScenario parses minimal config', () => {
  const config = parseScenario(MINIMAL_YAML);
  assertEquals(config.target, 'ws://localhost:3000');
  assertEquals(config.scenarios.length, 1);
  assertEquals(config.scenarios[0].name, 'basic');
  assertEquals(config.scenarios[0].duration, 10);
  assertEquals(config.scenarios[0].connections.target, 5);
  assertEquals(config.scenarios[0].connections.ramp, false);
  assertEquals(config.scenarios[0].events.rate, 0);
});

Deno.test('parseScenario parses full config with auth', () => {
  const yaml = `
target: "ws://localhost:3000"
metrics_url: "http://localhost:3000/metrics"
auth:
  enabled: true
  relay_url: "ws://localhost:7777"
  generate_keys: true
scenarios:
  - name: "load"
    duration: 60
    connections:
      target: 100
      ramp: true
      reset: true
    events:
      rate: 50
      kind: 1
      content_length: 200
      sign: true
    requests:
      rate: 10
      filters:
        kinds: [1]
        limit: 5
`;
  const config = parseScenario(yaml);
  assertEquals(config.auth?.enabled, true);
  assertEquals(config.auth?.relay_url, 'ws://localhost:7777');
  assertEquals(config.scenarios[0].connections.ramp, true);
  assertEquals(config.scenarios[0].connections.reset, true);
  assertEquals(config.scenarios[0].events.rate, 50);
  assertEquals(config.scenarios[0].events.sign, true);
  assertEquals(config.scenarios[0].requests.rate, 10);
});

Deno.test('parseScenario rejects missing target', () => {
  try {
    parseScenario('scenarios: [{ name: "x", duration: 1, connections: { target: 1 } }]');
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('target'), true);
  }
});

Deno.test('parseScenario rejects empty scenarios', () => {
  try {
    parseScenario('target: "ws://localhost:3000"\nscenarios: []');
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('scenario'), true);
  }
});
