// src/connections/types.ts
import type { ConnectionInfo } from '../plugins/types.ts';

export interface ManagedConnection {
  info: ConnectionInfo;
  clientIp: string;
  sendNotice: (message: string) => Promise<void>;
  close: (code?: number) => void;
  sendAuthChallenge: () => void;
}
