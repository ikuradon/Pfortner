import type { ConnectionManager } from '../connections/manager.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { ShutdownManager } from '../shutdown/manager.ts';

export interface RequestHandlerHooks {
  onConnect?: (managed: ManagedConnection) => void;
  onDisconnect?: (connectionId: string) => void;
  blocklist?: { pubkeys: Set<string>; ips: Set<string> };
  connectionManager?: ConnectionManager;
  shutdownManager?: ShutdownManager;
}

export type RequestHandler = (
  req: Request,
  conn: Deno.ServeHandlerInfo<Deno.NetAddr>,
) => Response;
