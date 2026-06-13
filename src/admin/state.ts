import type { PfortnerConfig } from '../config/loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { LogBuffer } from '../infra/log-buffer.ts';
import type { ThroughputTracker } from '../infra/throughput-tracker.ts';

export type AdminAuthState =
  | { enabled: false; path: '/admin' }
  | {
    enabled: true;
    path: '/admin';
    token: string;
    tokenSource: 'env' | 'file' | 'generated';
  };

export interface AdminRuntimeState {
  logging: { level: 'debug' | 'info' | 'warn' | 'error'; format: 'text' | 'json' };
  trustProxy: boolean;
  admin: { enabled: boolean; tokenSource?: 'env' | 'file' | 'generated' };
}

export interface AdminServiceState {
  config: PfortnerConfig;
  adminAuth: AdminAuthState;
  runtime: AdminRuntimeState;
  pluginNames: string[];
  connections: Map<string, ManagedConnection>;
  blocklist: { pubkeys: Set<string>; ips: Set<string> };
  configPath?: string;
  pipelineDraftPath?: string;
  reloadFn?: (yamlString: string) => Promise<void>;
  shutdownManager?: { isDraining(): boolean; initiateShutdown(): Promise<void> };
  connectionManager?: { getStats(): unknown };
  upstreamProbe?: { getLatency(): number | null; getStatus(): string };
  startTime?: number;
  throughputTracker?: ThroughputTracker;
  logBuffer?: LogBuffer;
}
