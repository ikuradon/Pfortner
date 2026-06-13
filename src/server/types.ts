export type AdminAuthState =
  | { enabled: false; path: '/admin' }
  | {
    enabled: true;
    path: '/admin';
    token: string;
    tokenSource: 'env' | 'file' | 'generated';
  };

export interface RuntimeEnvelope {
  dataDir: string;
  listen: { hostname: string; port: number };
  trustProxy: boolean;
  adminAuth: AdminAuthState;
  logging: { level: 'debug' | 'info' | 'warn' | 'error'; format: 'text' | 'json' };
  backend: {
    kv: { path: string };
    redis?: { url: string; keyPrefix?: string };
  };
}

export interface ParsedServerEnv {
  dataDir: string;
  listen: { hostname: string; port: number };
  adminEnabled: boolean;
  adminToken?: string;
  adminTokenFile: string;
  logging: RuntimeEnvelope['logging'];
  trustProxy: boolean;
  redisUrl?: string;
  redisUrlFile?: string;
  redisKeyPrefix?: string;
}
