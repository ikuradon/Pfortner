export { type ConnectionInfo, type OutputMessage, pfortnerInit, type Policy } from './src/pfortner.ts';

export { acceptPolicy } from './src/policies/AcceptPolicy.ts';
export { eventSifterPolicy } from './src/policies/EventSifterPolicy.ts';

// Plugin system
export { loadConfigFromFile, loadConfigFromString } from './src/config/loader.ts';
export type { PfortnerConfig, PipelineEntry } from './src/config/loader.ts';
export { buildRequestHandler } from './src/config/starter.ts';
export type { RequestHandler } from './src/config/starter.ts';
export type { InfraContext, PfortnerInstance, PolicyFactory, PolicyPlugin } from './src/plugins/types.ts';
export { extractEvent } from './src/plugins/types.ts';
export { createPluginRegistry } from './src/plugins/registry.ts';
export type { PluginRegistry } from './src/plugins/registry.ts';
export { buildInfraContext } from './src/infra/context.ts';
export { createGeoIpLookup, type GeoIpLookup } from './src/infra/geoip.ts';
export { createRedisClient } from './src/infra/redis.ts';
export type { RedisOptions } from './src/infra/redis.ts';
export { createKvClient } from './src/infra/kv.ts';
export type { KvOptions } from './src/infra/kv.ts';
export { buildRelayInfo } from './src/config/relay-info.ts';
export type { RelayInfo } from './src/config/relay-info.ts';
export { createPrometheusMetrics } from './src/infra/prometheus.ts';
export type { PrometheusMetrics } from './src/infra/prometheus.ts';
export { createAdminHandler } from './src/admin/server.ts';
export type { AdminState } from './src/admin/server.ts';
export { ConfigManager } from './src/config/manager.ts';

// Operational hardening
export { ShutdownManager } from './src/shutdown/manager.ts';
export { ConnectionManager } from './src/connections/manager.ts';
export type { ConnectionOptions, ConnectionStats } from './src/connections/manager.ts';
export type { ManagedConnection } from './src/connections/types.ts';
export { UpstreamProbe } from './src/connections/upstream-probe.ts';

// WoT graph builder
export { buildWotGraph, parseContactList, type QueryFn } from './src/wot/builder.ts';
export { createRelayQueryFn, parseRelayResponse } from './src/wot/relay-query.ts';

// Policy plugins
export { kindFilterPlugin } from './src/policies/KindFilterPolicy.ts';
export { writeGuardPlugin } from './src/policies/WriteGuardPolicy.ts';
export { protectedEventPlugin } from './src/policies/ProtectedEventPolicy.ts';
export { rateLimitPlugin } from './src/policies/RateLimitPolicy.ts';
export { spamFilterPlugin } from './src/policies/SpamFilterPolicy.ts';
export { contentFilterPlugin } from './src/policies/ContentFilterPolicy.ts';
export { pubkeyAclPlugin } from './src/policies/PubkeyAclPolicy.ts';
export { ipFilterPlugin } from './src/policies/IpFilterPolicy.ts';
export { whenPlugin } from './src/policies/WhenPlugin.ts';
export { matchPlugin } from './src/policies/MatchPlugin.ts';
export { routePlugin } from './src/policies/RoutePlugin.ts';
export { evaluateCondition } from './src/conditions/evaluator.ts';
export type { Condition, EvalContext, SimpleCondition } from './src/conditions/types.ts';
export { buildEvalContext } from './src/conditions/context.ts';

// Upstream routing
export { UpstreamConnection, UpstreamPool } from './src/upstream/pool.ts';
