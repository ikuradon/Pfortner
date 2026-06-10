import type { PfortnerConfig } from '../config/loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { LogBuffer } from '../infra/log-buffer.ts';
import type { ThroughputTracker } from '../infra/throughput-tracker.ts';

export interface AdminServiceState {
  config: PfortnerConfig;
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
