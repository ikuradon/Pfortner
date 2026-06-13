import type { ParsedServerEnv } from './types.ts';

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LOG_FORMATS = new Set(['text', 'json']);

export function parseServerEnv(
  env: Pick<Map<string, string>, 'get'> = envMapFromDeno(),
  args = Deno.args,
): ParsedServerEnv {
  const dataDir = readDataDir(env, args);
  const listenPort = parsePort(env.get('PFORTNER_LISTEN_PORT') ?? '3000');
  const listenAddr = env.get('PFORTNER_LISTEN_ADDR') ?? '[::]';
  const adminEnabled = parseBoolean(env.get('PFORTNER_ADMIN_ENABLED'), true);
  const logLevel = env.get('PFORTNER_LOG_LEVEL') ?? 'info';
  const logFormat = env.get('PFORTNER_LOG_FORMAT') ?? 'text';
  if (!LOG_LEVELS.has(logLevel)) throw new Error('PFORTNER_LOG_LEVEL must be one of debug, info, warn, error');
  if (!LOG_FORMATS.has(logFormat)) throw new Error('PFORTNER_LOG_FORMAT must be one of text, json');

  return {
    dataDir,
    listen: { hostname: listenAddr, port: listenPort },
    adminEnabled,
    adminToken: env.get('PFORTNER_ADMIN_TOKEN') || undefined,
    adminTokenFile: env.get('PFORTNER_ADMIN_TOKEN_FILE') || `${dataDir}/admin-token`,
    logging: {
      level: logLevel as ParsedServerEnv['logging']['level'],
      format: logFormat as ParsedServerEnv['logging']['format'],
    },
    trustProxy: parseBoolean(env.get('PFORTNER_TRUST_PROXY'), false),
    redisUrl: env.get('PFORTNER_REDIS_URL') || undefined,
    redisUrlFile: env.get('PFORTNER_REDIS_URL_FILE') || undefined,
    redisKeyPrefix: env.get('PFORTNER_REDIS_KEY_PREFIX') || undefined,
  };
}

function readDataDir(env: Pick<Map<string, string>, 'get'>, args: string[]): string {
  let dataDir = env.get('PFORTNER_DATA_DIR') || '/data';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--data-dir') {
      const value = args[++index];
      if (!value) throw new Error('--data-dir requires a value');
      dataDir = value;
      continue;
    }
    if (arg.endsWith('.yaml') || arg.endsWith('.yml')) {
      throw new Error('config path mode was removed; use --data-dir or PFORTNER_DATA_DIR');
    }
    if (arg.startsWith('--')) throw new Error(`Unknown server argument: ${arg}`);
    throw new Error('Unexpected server argument; config path mode was removed; use --data-dir or PFORTNER_DATA_DIR');
  }
  return dataDir;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PFORTNER_LISTEN_PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Boolean env value must be "true" or "false", got "${value}"`);
}

function envMapFromDeno(): Map<string, string> {
  return new Map(Object.entries(Deno.env.toObject()));
}
