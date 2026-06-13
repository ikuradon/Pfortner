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

type ServerConfig = PfortnerConfig['server'];
type AdminConfig = NonNullable<PfortnerConfig['admin']>;
type InfraConfig = NonNullable<PfortnerConfig['infra']>;
type InfraRedisConfig = NonNullable<InfraConfig['redis']>;
type InfraKvConfig = NonNullable<InfraConfig['kv']>;
type MetricsConfig = NonNullable<InfraConfig['metrics']>;
type PrometheusConfig = NonNullable<MetricsConfig['prometheus']>;

export type ProductionPfortnerConfig = Omit<PfortnerConfig, 'server' | 'admin' | 'infra'> & {
  server: Omit<ServerConfig, 'port' | 'x_forwarded_for'>;
  admin?: Omit<AdminConfig, 'enabled' | 'port' | 'path' | 'auth_token' | 'trust_proxy'>;
  infra?: Omit<InfraConfig, 'redis' | 'kv' | 'metrics'> & {
    redis?: Omit<InfraRedisConfig, 'url' | 'key_prefix'>;
    kv?: Omit<InfraKvConfig, 'path'>;
    metrics?: Omit<MetricsConfig, 'logging' | 'prometheus'> & {
      prometheus?: Omit<PrometheusConfig, 'port' | 'path'>;
    };
  };
};

export interface RuntimeBackendAvailability {
  kvAvailable: boolean;
  redisAvailable: boolean;
}

export interface ConfigLoadOptions {
  expandEnv?: boolean;
  production?: boolean;
  backend?: RuntimeBackendAvailability;
}

function validate(config: any, options: ConfigLoadOptions = {}): string[] {
  const errors: string[] = [];
  if (!config.server?.upstream_relay) errors.push('server.upstream_relay is required');
  if (options.production) {
    validateNoEnvOwnedKeys(config, errors);
  }
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
  // 警告
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
    const needsBackend = allEntries.some(
      (e: any) =>
        e.config?.backend === 'redis' ||
        e.config?.backend === 'kv' ||
        e.config?.reject_duplicate?.backend === 'redis' ||
        e.config?.reject_duplicate?.backend === 'kv',
    );
    const legacyBackendUnavailable = !config.infra?.redis?.url && !config.infra?.kv?.path;
    validateRuntimeBackend(
      options.production ? needsBackend : needsBackend && legacyBackendUnavailable,
      allEntries,
      options,
      errors,
    );
  }
  return errors;
}

function validateNoEnvOwnedKeys(config: any, errors: string[]): void {
  const checks: Array<[boolean, string]> = [
    [config.server?.port != null, 'server.port is env-owned; use PFORTNER_LISTEN_PORT'],
    [config.server?.x_forwarded_for != null, 'server.x_forwarded_for is env-owned; use PFORTNER_TRUST_PROXY'],
    [config.admin?.enabled != null, 'admin.enabled is env-owned; use PFORTNER_ADMIN_ENABLED'],
    [config.admin?.port != null, 'admin.port is removed; Admin UI uses /admin on the main port'],
    [
      config.admin?.auth_token != null,
      'admin.auth_token is env-owned; use PFORTNER_ADMIN_TOKEN or PFORTNER_ADMIN_TOKEN_FILE',
    ],
    [config.admin?.trust_proxy != null, 'admin.trust_proxy is env-owned; use PFORTNER_TRUST_PROXY'],
    [config.admin?.path != null, 'admin.path is removed; Admin UI path is fixed at /admin'],
    [
      config.infra?.redis?.url != null,
      'infra.redis.url is env-owned; use PFORTNER_REDIS_URL or PFORTNER_REDIS_URL_FILE',
    ],
    [config.infra?.redis?.key_prefix != null, 'infra.redis.key_prefix is env-owned; use PFORTNER_REDIS_KEY_PREFIX'],
    [config.infra?.kv?.path != null, 'infra.kv.path is dataDir-derived'],
    [
      config.infra?.metrics?.logging != null,
      'infra.metrics.logging is env-owned; use PFORTNER_LOG_LEVEL and PFORTNER_LOG_FORMAT',
    ],
    [
      config.infra?.metrics?.prometheus?.port != null,
      'infra.metrics.prometheus.port is removed; /metrics is on the main port',
    ],
    [
      config.infra?.metrics?.prometheus?.path != null,
      'infra.metrics.prometheus.path is removed; metrics path is fixed at /metrics',
    ],
  ];
  for (const [present, message] of checks) {
    if (present) errors.push(message);
  }
}

function validateRuntimeBackend(
  needsBackend: boolean,
  entries: PipelineEntry[],
  options: ConfigLoadOptions,
  errors: string[],
): void {
  if (!needsBackend) return;
  const wantsRedis = entries.some((e: any) =>
    e.config?.backend === 'redis' || e.config?.reject_duplicate?.backend === 'redis'
  );
  const wantsKv = entries.some((e: any) => e.config?.backend === 'kv' || e.config?.reject_duplicate?.backend === 'kv');
  if (options.production) {
    if (wantsRedis && options.backend?.redisAvailable !== true) {
      errors.push(
        'A policy requires Redis backend but PFORTNER_REDIS_URL or PFORTNER_REDIS_URL_FILE is not configured',
      );
    }
    if (wantsKv && options.backend?.kvAvailable !== true) {
      errors.push('A policy requires KV backend but dataDir KV is not available');
    }
    return;
  }
  errors.push('A policy requires a backend but neither infra.redis nor infra.kv is configured');
}

export function loadConfigFromString(yamlString: string): PfortnerConfig {
  return loadConfigFromStringWithOptions(yamlString, { expandEnv: true, production: false });
}

export function loadProductionConfigFromString(
  yamlString: string,
  options: { backend: RuntimeBackendAvailability },
): ProductionPfortnerConfig {
  return loadConfigFromStringWithOptions<ProductionPfortnerConfig>(yamlString, {
    expandEnv: false,
    production: true,
    backend: options.backend,
  });
}

function loadConfigFromStringWithOptions<TConfig = PfortnerConfig>(
  yamlString: string,
  options: ConfigLoadOptions,
): TConfig {
  const raw = parseYaml(yamlString) as Record<string, unknown>;
  const parsed = options.expandEnv === false ? raw : expandEnvVars(raw);
  if (!options.production && (parsed as any).server && !(parsed as any).server.port) {
    (parsed as any).server.port = 3000;
  }
  const errors = validate(parsed, options);
  if (errors.length > 0) throw new Error('Config validation failed:\n  ' + errors.join('\n  '));
  return parsed as unknown as TConfig;
}

export async function loadConfigFromFile(path: string): Promise<PfortnerConfig> {
  const content = await Deno.readTextFile(path);
  return loadConfigFromString(content);
}
