import { parse as parseYaml } from '@std/yaml';

export interface BenchAuth {
  enabled: boolean;
  relay_url?: string;
  private_key?: string;
  generate_keys?: boolean;
}

export interface BenchScenario {
  name: string;
  duration: number;
  connections: { target: number; ramp: boolean; reset: boolean };
  events: { rate: number; kind: number; content_length: number; sign: boolean };
  requests: { rate: number; filters: Record<string, unknown> };
}

export interface BenchConfig {
  target: string;
  metrics_url?: string;
  auth?: BenchAuth;
  scenarios: BenchScenario[];
}

export function parseScenario(yamlString: string): BenchConfig {
  const raw = parseYaml(yamlString) as any;

  if (!raw.target) throw new Error('target is required');
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    throw new Error('At least one scenario is required');
  }

  const scenarios: BenchScenario[] = raw.scenarios.map((s: any) => ({
    name: s.name ?? 'unnamed',
    duration: s.duration ?? 10,
    connections: {
      target: s.connections?.target ?? 1,
      ramp: s.connections?.ramp ?? false,
      reset: s.connections?.reset ?? false,
    },
    events: {
      rate: s.events?.rate ?? 0,
      kind: s.events?.kind ?? 1,
      content_length: s.events?.content_length ?? 32,
      sign: s.events?.sign ?? false,
    },
    requests: {
      rate: s.requests?.rate ?? 0,
      filters: s.requests?.filters ?? {},
    },
  }));

  return {
    target: raw.target,
    metrics_url: raw.metrics_url,
    auth: raw.auth
      ? {
        enabled: raw.auth.enabled ?? false,
        relay_url: raw.auth.relay_url,
        private_key: raw.auth.private_key,
        generate_keys: raw.auth.generate_keys,
      }
      : undefined,
    scenarios,
  };
}

export async function parseScenarioFile(path: string): Promise<BenchConfig> {
  const content = await Deno.readTextFile(path);
  return parseScenario(content);
}
