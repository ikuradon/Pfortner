import type { ConnectionManager } from '../connections/manager.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { ShutdownManager } from '../shutdown/manager.ts';
import type { ThroughputTracker } from '../infra/throughput-tracker.ts';

export interface RequestHandlerHooks {
  onConnect?: (managed: ManagedConnection) => void;
  onDisconnect?: (connectionId: string) => void;
  blocklist?: { pubkeys: Set<string>; ips: Set<string> };
  connectionManager?: ConnectionManager;
  shutdownManager?: ShutdownManager;
  throughputTracker?: ThroughputTracker;
}

export type RequestHandler = (
  req: Request,
  conn: Deno.ServeHandlerInfo<Deno.NetAddr>,
) => Response;
