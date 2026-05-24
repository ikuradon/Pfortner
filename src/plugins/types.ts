import { type ConnectionInfo, type OutputMessage, type Policy } from '../pfortner.ts';

export type { ConnectionInfo, OutputMessage, Policy };

// Subset of pfortnerInit() return. Structural typing ensures compatibility.
export interface PfortnerInstance {
  sendAuthMessage: () => void;
  sendMessageToClient: (message: string) => Promise<void>;
  relayServerMessageToClient?: (message: unknown[]) => Promise<void>;
  connectionInfo: ConnectionInfo;
}

// Extract event from EVENT message regardless of direction.
// Client→relay: ['EVENT', event] (length 2)
// Relay→client: ['EVENT', subscriptionId, event] (length 3)
export function extractEvent(message: unknown[]): { event: any; subscriptionId?: string } | null {
  if (message[0] !== 'EVENT') return null;
  if (message.length === 3) return { subscriptionId: message[1] as string, event: message[2] };
  if (message.length === 2) return { event: message[1] };
  return null;
}

export type PolicyFactory = (instance: PfortnerInstance) => Policy;

export interface PolicyPlugin {
  name: string;
  description: string;
  direction: 'client' | 'server' | 'both';
  configSchema: Record<string, unknown>;
  initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory>;
  destroy?(): Promise<void>;
}

export interface MetricsCollector {
  counter(name: string, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
}

export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}

export interface HttpClient {
  fetch(url: string, options?: RequestInit & { timeout?: number }): Promise<Response>;
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttl: number): Promise<void>;
  sadd(key: string, ...members: string[]): Promise<number>;
  sismember(key: string, member: string): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  // Sorted set operations (for sliding window rate limiting)
  zadd(key: string, score: number, member: string): Promise<number>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  close(): Promise<void>;
}

export interface InfraContext {
  redis?: RedisClient;
  kv?: Deno.Kv;
  metrics: MetricsCollector;
  logger: Logger;
  httpClient: HttpClient;
  currentDirection?: 'client' | 'server';
  pipelineResolver?: (
    entries: Array<{ policy: string; config?: Record<string, unknown> }>,
    direction: 'client' | 'server',
  ) => Promise<PolicyFactory[]>;
  upstreamPool?: {
    getConnection(url: string): Promise<any>;
    notifyClientDisconnect(clientId: string): void;
    closeAll(): Promise<void> | void;
  };
}
