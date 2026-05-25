import { parse as parseYaml } from '@std/yaml';
import { expandEnvVars } from './env.ts';
import { BUILTIN_PLUGIN_NAME_SET } from '../plugins/builtin-names.ts';

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
    shutdown?: { drain_timeout?: number; force_after?: number };
    connections?: {
      max?: number;
      max_per_ip?: number;
      pressure?: { soft_limit_percent?: number; auth_grace_period?: number };
    };
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
  admin?: { enabled?: boolean; port?: number; path?: string; auth_token?: string; trust_proxy?: boolean };
  plugins?: Array<{ name: string; url?: string; path?: string }>;
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
  if (config.plugins != null) {
    if (!Array.isArray(config.plugins)) {
      errors.push('plugins must be an array');
    } else {
      const pluginNames = new Set<string>();
      config.plugins.forEach((plugin: any, i: number) => {
        if (!plugin?.name) errors.push(`plugins[${i}].name is required`);
        if (plugin?.name) {
          if (BUILTIN_PLUGIN_NAME_SET.has(plugin.name)) {
            errors.push(`External plugin name duplicates builtin plugin: ${plugin.name}`);
          }
          if (pluginNames.has(plugin.name)) errors.push(`Duplicate external plugin name: ${plugin.name}`);
          pluginNames.add(plugin.name);
        }
        const hasUrl = plugin?.url != null;
        const hasPath = plugin?.path != null;
        if (hasUrl === hasPath) errors.push(`plugins[${i}] requires exactly one of url or path`);
        if (plugin?.url === '' || plugin?.path === '') errors.push(`plugins[${i}] source must be non-empty`);
      });
    }
  }
  if (config.admin?.port != null) {
    console.warn(
      'Warning: admin.port is deprecated. Admin UI is now served on server.port under admin.path (default: /admin)',
    );
  }
  if (config.server?.connections?.max != null && config.server.connections.max < 1) {
    errors.push('server.connections.max must be >= 1');
  }
  if (config.server?.connections?.pressure?.soft_limit_percent != null) {
    const pct = config.server.connections.pressure.soft_limit_percent;
    if (pct < 0 || pct > 100) errors.push('server.connections.pressure.soft_limit_percent must be 0-100');
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
    // Check if any policy uses redis/kv backend but neither infra.redis nor infra.kv is configured
    const needsBackend = allEntries.some(
      (e: any) =>
        e.config?.backend === 'redis' ||
        e.config?.backend === 'kv' ||
        e.config?.reject_duplicate?.backend === 'redis' ||
        e.config?.reject_duplicate?.backend === 'kv',
    );
    if (needsBackend && !config.infra?.redis?.url && !config.infra?.kv?.path) {
      errors.push('A policy requires a backend but neither infra.redis nor infra.kv is configured');
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
