import { parse as parseYaml } from '@std/yaml';
import { expandEnvVars } from './env.ts';

export interface PipelineEntry {
  policy: string;
  config?: Record<string, unknown>;
}

export interface PfortnerConfig {
  server: {
    port: number;
    upstream_relay: string;
    upstream_raw_url?: string;
    idle_timeout?: number;
    x_forwarded_for?: boolean;
  };
  auth?: {
    enabled?: boolean;
    send_on_connect?: boolean;
    max_attempts?: number;
    allowed_time_duration?: number;
    allowed_future_time_duration?: number;
  };
  infra?: {
    redis?: { url: string; key_prefix?: string };
    kv?: { path: string };
    metrics?: {
      prometheus?: { enabled: boolean; port: number; path?: string };
      logging?: { format: 'json' | 'text'; level: 'debug' | 'info' | 'warn' | 'error' };
    };
    http?: { default_timeout?: number; user_agent?: string };
  };
  relay_info?: { name?: string; description?: string; contact?: string; software?: string };
  admin?: { enabled?: boolean; port?: number; auth_token?: string };
  plugins?: Array<{ url?: string; path?: string }>;
  pipelines: { client: PipelineEntry[]; server: PipelineEntry[] };
}

function validate(config: any): string[] {
  const errors: string[] = [];
  if (!config.server?.upstream_relay) errors.push('server.upstream_relay is required');
  if (!config.pipelines) {
    errors.push('pipelines section is required');
  } else {
    if (!Array.isArray(config.pipelines.client)) errors.push('pipelines.client must be an array');
    if (!Array.isArray(config.pipelines.server)) errors.push('pipelines.server must be an array');
  }
  if (config.admin?.enabled && !config.admin?.auth_token) {
    errors.push('admin.auth_token is required when admin.enabled is true');
  }
  // Warnings
  if (config.pipelines) {
    const allEntries = [...(config.pipelines.client ?? []), ...(config.pipelines.server ?? [])];
    const hasAuthPolicy = allEntries.some(
      (e: any) =>
        (e.policy === 'write-guard' && e.config?.require_auth) ||
        (e.policy === 'kind-filter' && e.config?.require_auth_for?.length > 0),
    );
    if (hasAuthPolicy && config.auth?.enabled === false) {
      console.warn('Warning: write-guard or kind-filter requires auth, but auth.enabled is false');
    }
  }
  return errors;
}

export function loadConfigFromString(yamlString: string): PfortnerConfig {
  const raw = parseYaml(yamlString) as Record<string, unknown>;
  const expanded = expandEnvVars(raw);
  if (expanded.server && !expanded.server.port) expanded.server.port = 3000;
  const errors = validate(expanded);
  if (errors.length > 0) throw new Error('Config validation failed:\n  ' + errors.join('\n  '));
  return expanded as unknown as PfortnerConfig;
}

export async function loadConfigFromFile(path: string): Promise<PfortnerConfig> {
  const content = await Deno.readTextFile(path);
  return loadConfigFromString(content);
}
