import { assertEquals, assertThrows } from '@std/assert';
import { parseServerEnv } from './env.ts';

Deno.test('parseServerEnv returns defaults for Docker runtime', () => {
  const env = parseServerEnv(new Map(), []);
  assertEquals(env.dataDir, '/data');
  assertEquals(env.listen, { hostname: '[::]', port: 3000 });
  assertEquals(env.adminEnabled, true);
  assertEquals(env.adminTokenFile, '/data/admin-token');
  assertEquals(env.logging, { level: 'info', format: 'text' });
  assertEquals(env.trustProxy, false);
});

Deno.test('parseServerEnv accepts PFORTNER_ADMIN_ENABLED=false without token settings', () => {
  const env = parseServerEnv(new Map([['PFORTNER_ADMIN_ENABLED', 'false']]), []);
  assertEquals(env.adminEnabled, false);
  assertEquals(env.adminToken, undefined);
  assertEquals(env.adminTokenFile, '/data/admin-token');
});

Deno.test('parseServerEnv uses --data-dir over PFORTNER_DATA_DIR', () => {
  const env = parseServerEnv(
    new Map([['PFORTNER_DATA_DIR', '/env-data']]),
    ['--data-dir', '/cli-data'],
  );
  assertEquals(env.dataDir, '/cli-data');
});

Deno.test('parseServerEnv rejects removed config path positional argument', () => {
  assertThrows(
    () => parseServerEnv(new Map(), ['pfortner.yaml']),
    Error,
    'config path mode was removed; use --data-dir or PFORTNER_DATA_DIR',
  );
});

Deno.test('parseServerEnv rejects unknown server flags', () => {
  assertThrows(
    () => parseServerEnv(new Map(), ['--config', 'pfortner.yaml']),
    Error,
    'Unknown server argument: --config',
  );
});

Deno.test('parseServerEnv rejects invalid port', () => {
  assertThrows(
    () => parseServerEnv(new Map([['PFORTNER_LISTEN_PORT', 'abc']]), []),
    Error,
    'PFORTNER_LISTEN_PORT must be an integer between 1 and 65535',
  );
});
