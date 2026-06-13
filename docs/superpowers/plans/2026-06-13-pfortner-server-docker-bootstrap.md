# Pfortner Server Docker Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker image から起動できる Admin UI first の Pfortner Server runtime を作り、production 起動を config path ではなく dataDir/bootstrap に移す。

**Architecture:** `src/server/*` を production composition root にし、env-only の runtime envelope、dataDir state、Admin token、setup mode、normal relay runtime を分離する。Product behavior は dataDir 内 `config.yaml` と Admin UI が所有し、env-owned fields は production config から落とす。既存 admin service/read model/action は維持し、UI relocation は server runtime が動いてから機械的に `src/admin/ui/*` へ移す。

**Tech Stack:** Deno 2.x, Fresh 2.x, Preact, TypeScript, Deno test/fmt/lint/check, Docker, existing esbuild admin asset bundler.

---

## 前提

- 承認済み spec: `docs/superpowers/specs/2026-06-13-pfortner-server-docker-bootstrap-design.md`
- 現行構造: `docs/current-architecture.md`
- `deno` が PATH に無い場合は `/root/.local/share/mise/installs/deno/2.8.3/bin/deno` を使う。
- `docs/superpowers/` は `.gitignore` 配下なので、plan/spec を stage するときは `git add -f` を使う。
- 各 task の最初に `git status --short` を確認し、task 対象外の差分は stage しない。
- 各 task は red test を追加して fail を確認し、実装後に targeted verification を通し、atomic commit にする。

## File Structure

新規 server runtime files:

- `src/server/env.ts`: `PFORTNER_*` env と `--data-dir` を parse し、listen/logging/admin/backend env の raw settings を返す。
- `src/server/data_dir.ts`: dataDir layout、directory 作成、config/draft/token/KV/plugin/geoip path の導出。
- `src/server/admin_token.ts`: admin enabled 時だけ token/env/file/generated を resolve する。
- `src/server/bootstrap.ts`: empty dataDir の setup state、setup-generated complete YAML、atomic config write。
- `src/server/runtime.ts`: infra、registry、ConfigManager、connection/shutdown/upstream/admin state を組み立てる。
- `src/server/handler.ts`: `/admin`、`/health`、`/metrics`、NIP-11、WebSocket の main port routing。
- `src/server/main.ts`: CLI/env parse、runtime start、top-level error handling。
- `src/server/types.ts`: `RuntimeEnvelope`、`AdminAuthState`、`ServerRuntime` など server runtime の共有 type。

既存 server/config files:

- `src/config/loader.ts`: legacy loader を維持しつつ production loader/options を追加する。
- `src/config/manager.ts`: production loader と request handler options を注入できるようにする。
- `src/config/starter.ts`: `buildRequestHandler()` に `trustProxy` option を追加する。
- `src/config/runtime-guards.ts`: `config.server.x_forwarded_for` ではなく runtime option の `trustProxy` を使えるようにする。

Admin runtime boundary files:

- `src/admin/state.ts`: `adminAuth` と `runtime` read model source を追加する。
- `src/admin/read_models/runtime.ts`: Admin UI 用 runtime envelope projection。
- `src/admin/server.ts`: Bearer handler auth を `state.adminAuth` に寄せる。
- `admin/http/auth_middleware.ts`: Fresh auth middleware を `state.adminAuth` と top-level `trustProxy` に寄せる。
- `admin/http/login_routes.ts`: login token check を `state.adminAuth` に寄せる。
- `admin/http/api_routes.ts`: `GET /admin/api/runtime` を追加する。
- `admin/client/fresh_nav.js`: Logs page の log level 表示を runtime endpoint へ移す。

Admin UI relocation files:

- Move `admin/app/*` -> `src/admin/ui/app/*`
- Move `admin/http/*` -> `src/admin/ui/http/*`
- Move `admin/pages/*` -> `src/admin/ui/pages/*`
- Move `admin/routes/*` -> `src/admin/ui/routes/*`
- Move `admin/components/*` -> `src/admin/ui/components/*`
- Move `admin/islands/*` -> `src/admin/ui/islands/*`
- Move `admin/client/*` -> `src/admin/ui/client/*`
- Move `admin/static/*` -> `src/admin/ui/static/*`
- Move root support files `admin/{main,security,static_files,route_types,fresh_islands,api_routes,page_routes}.ts` -> `src/admin/ui/`
- Remove root metadata `admin/deno.json` and `admin/deno.lock`
- Update `scripts/build_admin_islands.ts`, `deno.json`, import aliases, and import boundary tests.

Production integration files:

- `scripts/serve.ts`: production entrypoint から削除する。
- `deno.json`: `serve`/`dev`/`test`/lint exclude/build paths を `src/server/main.ts` と `src/admin/ui/static/` に合わせる。
- `Dockerfile`: `src/server/main.ts`、`/data` volume、Admin assets build、`/health` healthcheck に変更する。
- `docs/current-architecture.md`: final architecture を更新する。

## Task 1: Runtime Envelope, DataDir, Admin Token

**Files:**

- Create: `src/server/types.ts`
- Create: `src/server/env.ts`
- Create: `src/server/data_dir.ts`
- Create: `src/server/admin_token.ts`
- Test: `src/server/env.test.ts`
- Test: `src/server/data_dir.test.ts`
- Test: `src/server/admin_token.test.ts`

- [ ] **Step 1: 作業前状態を確認する**

Run:

```bash
git status --short
```

Expected: unrelated dirty files があれば記録し、Task 1 の stage 対象から外す。

- [ ] **Step 2: failing env tests を追加する**

Create `src/server/env.test.ts`:

```ts
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
  const env = parseServerEnv(new Map([['PFORTNER_DATA_DIR', '/env-data']]), ['--data-dir', '/cli-data']);
  assertEquals(env.dataDir, '/cli-data');
});

Deno.test('parseServerEnv rejects invalid port', () => {
  assertThrows(
    () => parseServerEnv(new Map([['PFORTNER_LISTEN_PORT', 'abc']]), []),
    Error,
    'PFORTNER_LISTEN_PORT must be an integer between 1 and 65535',
  );
});
```

Run:

```bash
deno test --allow-env src/server/env.test.ts
```

Expected: FAIL because `src/server/env.ts` does not exist.

- [ ] **Step 3: failing dataDir tests を追加する**

Create `src/server/data_dir.test.ts`:

```ts
import { assertEquals } from '@std/assert';
import { ensureDataDirLayout, resolveDataDirLayout } from './data_dir.ts';

Deno.test('resolveDataDirLayout derives all durable paths', () => {
  const layout = resolveDataDirLayout('/data');
  assertEquals(layout.root, '/data');
  assertEquals(layout.configPath, '/data/config.yaml');
  assertEquals(layout.adminTokenPath, '/data/admin-token');
  assertEquals(layout.pipelineDraftPath, '/data/pipeline-workbench.draft.json');
  assertEquals(layout.kvPath, '/data/kv/pfortner.sqlite3');
  assertEquals(layout.pluginsDir, '/data/plugins');
  assertEquals(layout.geoipDir, '/data/geoip');
});

Deno.test('ensureDataDirLayout creates directories but not config.yaml', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  assertEquals(await exists(layout.pluginsDir), true);
  assertEquals(await exists(layout.geoipDir), true);
  assertEquals(await exists(layout.configPath), false);
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
```

Run:

```bash
deno test --allow-read --allow-write src/server/data_dir.test.ts
```

Expected: FAIL because `src/server/data_dir.ts` does not exist.

- [ ] **Step 4: failing admin token tests を追加する**

Create `src/server/admin_token.test.ts`:

```ts
import { assertEquals, assertMatch } from '@std/assert';
import { resolveAdminAuth } from './admin_token.ts';

Deno.test('resolveAdminAuth returns disabled variant without reading token file', async () => {
  const auth = await resolveAdminAuth({
    enabled: false,
    tokenFile: '/path/that/does/not/exist',
  });
  assertEquals(auth, { enabled: false, path: '/admin' });
});

Deno.test('resolveAdminAuth uses PFORTNER_ADMIN_TOKEN before token file', async () => {
  const file = await Deno.makeTempFile();
  await Deno.writeTextFile(file, 'from-file');
  const auth = await resolveAdminAuth({
    enabled: true,
    token: 'from-env',
    tokenFile: file,
  });
  assertEquals(auth.enabled, true);
  if (auth.enabled) {
    assertEquals(auth.token, 'from-env');
    assertEquals(auth.tokenSource, 'env');
  }
});

Deno.test('resolveAdminAuth reuses existing token file', async () => {
  const file = await Deno.makeTempFile();
  await Deno.writeTextFile(file, 'existing-token\n');
  const auth = await resolveAdminAuth({ enabled: true, tokenFile: file });
  assertEquals(auth.enabled, true);
  if (auth.enabled) {
    assertEquals(auth.token, 'existing-token');
    assertEquals(auth.tokenSource, 'file');
  }
  assertEquals(await Deno.readTextFile(file), 'existing-token\n');
});

Deno.test('resolveAdminAuth generates a token when file is missing', async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/admin-token`;
  const auth = await resolveAdminAuth({ enabled: true, tokenFile: file });
  assertEquals(auth.enabled, true);
  if (auth.enabled) {
    assertEquals(auth.tokenSource, 'generated');
    assertMatch(auth.token, /^[A-Za-z0-9_-]{43,}$/);
    assertEquals(await Deno.readTextFile(file), auth.token);
  }
});
```

Run:

```bash
deno test --allow-read --allow-write src/server/admin_token.test.ts
```

Expected: FAIL because `src/server/admin_token.ts` does not exist.

- [ ] **Step 5: shared server types を作る**

Create `src/server/types.ts`:

```ts
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
```

- [ ] **Step 6: env parser を実装する**

Create `src/server/env.ts`:

```ts
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
  const index = args.indexOf('--data-dir');
  if (index >= 0) {
    const value = args[index + 1];
    if (!value) throw new Error('--data-dir requires a value');
    return value;
  }
  return env.get('PFORTNER_DATA_DIR') || '/data';
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
```

- [ ] **Step 7: dataDir helpers を実装する**

Create `src/server/data_dir.ts`:

```ts
import { join } from '@std/path';

export interface DataDirLayout {
  root: string;
  configPath: string;
  adminTokenPath: string;
  pipelineDraftPath: string;
  kvDir: string;
  kvPath: string;
  pluginsDir: string;
  geoipDir: string;
}

export function resolveDataDirLayout(root: string): DataDirLayout {
  return {
    root,
    configPath: join(root, 'config.yaml'),
    adminTokenPath: join(root, 'admin-token'),
    pipelineDraftPath: join(root, 'pipeline-workbench.draft.json'),
    kvDir: join(root, 'kv'),
    kvPath: join(root, 'kv', 'pfortner.sqlite3'),
    pluginsDir: join(root, 'plugins'),
    geoipDir: join(root, 'geoip'),
  };
}

export async function ensureDataDirLayout(root: string): Promise<DataDirLayout> {
  const layout = resolveDataDirLayout(root);
  await Deno.mkdir(layout.root, { recursive: true });
  await Deno.mkdir(layout.kvDir, { recursive: true });
  await Deno.mkdir(layout.pluginsDir, { recursive: true });
  await Deno.mkdir(layout.geoipDir, { recursive: true });
  await assertWritable(layout.root);
  return layout;
}

async function assertWritable(path: string): Promise<void> {
  const probe = join(path, `.pfortner-write-test-${crypto.randomUUID()}`);
  await Deno.writeTextFile(probe, '');
  await Deno.remove(probe);
}
```

- [ ] **Step 8: admin token resolver を実装する**

Create `src/server/admin_token.ts`:

```ts
import { dirname } from '@std/path';
import type { AdminAuthState } from './types.ts';

export interface AdminAuthInput {
  enabled: boolean;
  token?: string;
  tokenFile?: string;
}

export async function resolveAdminAuth(input: AdminAuthInput): Promise<AdminAuthState> {
  if (!input.enabled) return { enabled: false, path: '/admin' };
  if (input.token) return { enabled: true, path: '/admin', token: input.token, tokenSource: 'env' };
  if (!input.tokenFile) throw new Error('admin token file is required when admin is enabled');

  try {
    const token = (await Deno.readTextFile(input.tokenFile)).trim();
    if (token.length === 0) throw new Error('admin token file is empty');
    return { enabled: true, path: '/admin', token, tokenSource: 'file' };
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  const token = generateToken();
  await Deno.mkdir(dirname(input.tokenFile), { recursive: true });
  await Deno.writeTextFile(input.tokenFile, token);
  return { enabled: true, path: '/admin', token, tokenSource: 'generated' };
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
```

- [ ] **Step 9: Task 1 verification**

Run:

```bash
deno fmt --check --config deno.json src/server/types.ts src/server/env.ts src/server/data_dir.ts src/server/admin_token.ts src/server/env.test.ts src/server/data_dir.test.ts src/server/admin_token.test.ts
deno check src/server/types.ts src/server/env.ts src/server/data_dir.ts src/server/admin_token.ts
deno test --allow-env --allow-read --allow-write src/server/env.test.ts src/server/data_dir.test.ts src/server/admin_token.test.ts
```

Expected: all pass.

- [ ] **Step 10: Task 1 commit**

Run:

```bash
git add src/server/types.ts src/server/env.ts src/server/data_dir.ts src/server/admin_token.ts src/server/env.test.ts src/server/data_dir.test.ts src/server/admin_token.test.ts
git commit -m "feat: add server runtime envelope foundations"
```

## Task 2: Production Config Loader And Backend Validation

**Files:**

- Modify: `src/config/loader.ts`
- Modify: `src/config/manager.ts`
- Test: `src/config/loader.test.ts`
- Test: `src/config/manager.test.ts`

- [ ] **Step 1: failing loader tests を追加する**

Append to `src/config/loader.test.ts`:

```ts
Deno.test('loadProductionConfigFromString rejects env-owned config keys', () => {
  assertThrows(
    () =>
      loadProductionConfigFromString(
        `
server:
  port: 3001
  upstream_relay: "ws://localhost:7777"
pipelines:
  client: []
  server: []
`,
        { backend: { kvAvailable: true, redisAvailable: false } },
      ),
    Error,
    'server.port is env-owned',
  );
});

Deno.test('loadProductionConfigFromString does not expand env placeholders', () => {
  const config = loadProductionConfigFromString(
    `
server:
  upstream_relay: "\${TEST_RELAY}"
pipelines:
  client: []
  server: []
`,
    { backend: { kvAvailable: true, redisAvailable: false } },
  );
  assertEquals(config.server.upstream_relay, '${TEST_RELAY}');
});

Deno.test('loadProductionConfigFromString accepts kv backend when runtime kv is available', () => {
  const config = loadProductionConfigFromString(
    `
server:
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: rate-limit
      config:
        backend: kv
  server: []
`,
    { backend: { kvAvailable: true, redisAvailable: false } },
  );
  assertEquals(config.pipelines.client[0].policy, 'rate-limit');
});

Deno.test('loadProductionConfigFromString rejects redis backend without runtime redis', () => {
  assertThrows(
    () =>
      loadProductionConfigFromString(
        `
server:
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: rate-limit
      config:
        backend: redis
  server: []
`,
        { backend: { kvAvailable: true, redisAvailable: false } },
      ),
    Error,
    'requires Redis backend',
  );
});
```

Add the import:

```ts
import { loadConfigFromString, loadProductionConfigFromString } from './loader.ts';
```

Run:

```bash
deno test --allow-env src/config/loader.test.ts
```

Expected: FAIL because `loadProductionConfigFromString` does not exist.

- [ ] **Step 2: production loader を実装する**

Modify `src/config/loader.ts`:

```ts
export interface RuntimeBackendAvailability {
  kvAvailable: boolean;
  redisAvailable: boolean;
}

export interface ConfigLoadOptions {
  expandEnv?: boolean;
  production?: boolean;
  backend?: RuntimeBackendAvailability;
}
```

Change `validate(config: any)` to:

```ts
function validate(config: any, options: ConfigLoadOptions = {}): string[] {
  const errors: string[] = [];
  if (!config.server?.upstream_relay) errors.push('server.upstream_relay is required');
  if (options.production) {
    validateNoEnvOwnedKeys(config, errors);
  }
  // keep existing validation body
  const backend = options.backend;
  // replace backend check with runtime-aware check shown below
  return errors;
}
```

Add helpers:

```ts
function validateNoEnvOwnedKeys(config: any, errors: string[]): void {
  const checks: Array<[boolean, string]> = [
    [config.server?.port != null, 'server.port is env-owned; use PFORTNER_LISTEN_PORT'],
    [config.server?.x_forwarded_for != null, 'server.x_forwarded_for is env-owned; use PFORTNER_TRUST_PROXY'],
    [config.admin?.enabled != null, 'admin.enabled is env-owned; use PFORTNER_ADMIN_ENABLED'],
    [config.admin?.port != null, 'admin.port is removed; Admin UI uses /admin on the main port'],
    [
      config.admin?.auth_token != null,
      'admin.auth_token is env-owned; use PFORTNER_ADMIN_TOKEN or PFORTNER_ADMIN_TOKEN_FILE',
    ],
    [config.admin?.trust_proxy != null, 'admin.trust_proxy is env-owned; use PFORTNER_TRUST_PROXY'],
    [config.admin?.path != null, 'admin.path is removed; Admin UI path is fixed at /admin'],
    [
      config.infra?.redis?.url != null,
      'infra.redis.url is env-owned; use PFORTNER_REDIS_URL or PFORTNER_REDIS_URL_FILE',
    ],
    [config.infra?.redis?.key_prefix != null, 'infra.redis.key_prefix is env-owned; use PFORTNER_REDIS_KEY_PREFIX'],
    [config.infra?.kv?.path != null, 'infra.kv.path is dataDir-derived'],
    [
      config.infra?.metrics?.logging != null,
      'infra.metrics.logging is env-owned; use PFORTNER_LOG_LEVEL and PFORTNER_LOG_FORMAT',
    ],
    [
      config.infra?.metrics?.prometheus?.port != null,
      'infra.metrics.prometheus.port is removed; /metrics is on the main port',
    ],
    [
      config.infra?.metrics?.prometheus?.path != null,
      'infra.metrics.prometheus.path is removed; metrics path is fixed at /metrics',
    ],
  ];
  for (const [present, message] of checks) {
    if (present) errors.push(message);
  }
}

function validateRuntimeBackend(
  needsBackend: boolean,
  entries: PipelineEntry[],
  options: ConfigLoadOptions,
  errors: string[],
): void {
  if (!needsBackend) return;
  const wantsRedis = entries.some((e: any) =>
    e.config?.backend === 'redis' || e.config?.reject_duplicate?.backend === 'redis'
  );
  const wantsKv = entries.some((e: any) => e.config?.backend === 'kv' || e.config?.reject_duplicate?.backend === 'kv');
  if (options.production) {
    if (wantsRedis && options.backend?.redisAvailable !== true) {
      errors.push('A policy requires Redis backend but PFORTNER_REDIS_URL is not configured');
    }
    if (wantsKv && options.backend?.kvAvailable !== true) {
      errors.push('A policy requires KV backend but dataDir KV is not available');
    }
    return;
  }
  if (needsBackend) {
    // preserve legacy behavior
  }
}
```

Replace loader exports:

```ts
export function loadConfigFromString(yamlString: string): PfortnerConfig {
  return loadConfigFromStringWithOptions(yamlString, { expandEnv: true, production: false });
}

export function loadProductionConfigFromString(
  yamlString: string,
  options: { backend: RuntimeBackendAvailability },
): PfortnerConfig {
  return loadConfigFromStringWithOptions(yamlString, {
    expandEnv: false,
    production: true,
    backend: options.backend,
  });
}

function loadConfigFromStringWithOptions(yamlString: string, options: ConfigLoadOptions): PfortnerConfig {
  const raw = parseYaml(yamlString) as Record<string, unknown>;
  const parsed = options.expandEnv === false ? raw : expandEnvVars(raw);
  const errors = validate(parsed, options);
  if (errors.length > 0) throw new Error('Config validation failed:\n  ' + errors.join('\n  '));
  return parsed as unknown as PfortnerConfig;
}
```

Do not add default `server.port` in production mode.

- [ ] **Step 3: ConfigManager loader injection test を追加する**

Append to `src/config/manager.test.ts`:

```ts
Deno.test('ConfigManager uses injected config loader for create and reload', async () => {
  const yaml = `
server:
  upstream_relay: "ws://localhost:7777"
pipelines:
  client: []
  server: []
`;
  let calls = 0;
  const manager = await ConfigManager.create(yaml, buildInfraContext(), createPluginRegistry(), undefined, {
    loadConfig: (content) => {
      calls++;
      return loadConfigFromString(content);
    },
    requestHandlerOptions: { trustProxy: true },
  });
  await manager.reload(yaml);
  assertEquals(calls, 2);
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/config/manager.test.ts
```

Expected: FAIL because `ConfigManager.create` does not accept the options argument.

- [ ] **Step 4: ConfigManager options を実装する**

Modify `src/config/manager.ts`:

```ts
interface ConfigManagerOptions {
  loadConfig?: (yamlString: string) => PfortnerConfig;
  requestHandlerOptions?: { trustProxy?: boolean };
}
```

Add private fields and constructor arg:

```ts
private loadConfig: (yamlString: string) => PfortnerConfig;
private requestHandlerOptions?: { trustProxy?: boolean };
```

Update `create()` signature:

```ts
static async create(
  yamlString: string,
  infra: InfraContext,
  registry: PluginRegistry,
  hooks?: RequestHandlerHooks,
  options: ConfigManagerOptions = {},
): Promise<ConfigManager> {
  const loadConfig = options.loadConfig ?? loadConfigFromString;
  const config = loadConfig(yamlString);
  const usedPlugins = ConfigManager.collectPlugins(config, registry);
  const handler = await buildRequestHandler(config, infra, registry, hooks, options.requestHandlerOptions);
  const gen: Generation = { id: 0, handler, plugins: usedPlugins, activeCount: 0 };
  return new ConfigManager(gen, infra, registry, hooks, loadConfig, options.requestHandlerOptions);
}
```

Update `reload()`:

```ts
const config = this.loadConfig(yamlString);
const handler = await buildRequestHandler(config, this.infra, this.registry, this.hooks, this.requestHandlerOptions);
```

- [ ] **Step 5: Task 2 verification**

Run:

```bash
deno fmt --check --config deno.json src/config/loader.ts src/config/loader.test.ts src/config/manager.ts src/config/manager.test.ts
deno check src/config/loader.ts src/config/manager.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/config/loader.test.ts src/config/manager.test.ts
```

Expected: all pass.

- [ ] **Step 6: Task 2 commit**

Run:

```bash
git add src/config/loader.ts src/config/loader.test.ts src/config/manager.ts src/config/manager.test.ts
git commit -m "feat: add production config loading"
```

## Task 3: Trust Proxy Runtime Guard Handoff

**Files:**

- Modify: `src/config/starter.ts`
- Modify: `src/config/runtime-guards.ts`
- Test: `src/config/runtime-guards.test.ts`
- Test: `src/config/starter.test.ts`

- [ ] **Step 1: failing runtime guard tests を追加する**

Append to `src/config/runtime-guards.test.ts`:

```ts
Deno.test('runtime guards use explicit trustProxy option instead of config.server.x_forwarded_for', () => {
  const config = makeConfig(false);
  const req = new Request('http://localhost/', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  });
  const conn = { remoteAddr: { hostname: '10.0.0.5', port: 1234, transport: 'tcp' } } as Deno.ServeHandlerInfo<
    Deno.NetAddr
  >;

  const result = evaluateRuntimeGuards({ config, req, conn, trustProxy: true });
  assertEquals(result.clientIp, '203.0.113.10');
});
```

Run:

```bash
deno test --allow-env src/config/runtime-guards.test.ts
```

Expected: FAIL because `evaluateRuntimeGuards()` does not accept `trustProxy`.

- [ ] **Step 2: `evaluateRuntimeGuards` を runtime option 対応にする**

Modify `src/config/runtime-guards.ts` signature:

```ts
export function evaluateRuntimeGuards({
  config,
  hooks,
  req,
  conn,
  trustProxy = config.server.x_forwarded_for === true,
}: {
  config: PfortnerConfig;
  hooks?: RequestHandlerHooks;
  req: Request;
  conn: Deno.ServeHandlerInfo<Deno.NetAddr>;
  trustProxy?: boolean;
}): RuntimeGuardResult {
  const clientIp = selectClientIp(req, {
    remoteHostname: remoteHostnameFromConn(conn),
    trustForwardedFor: trustProxy,
  });
  // keep existing guard body
}
```

The fallback keeps legacy tests passing until production config removes `server.x_forwarded_for`.

- [ ] **Step 3: `buildRequestHandler` option を追加する**

Modify `src/config/starter.ts`:

```ts
export interface RequestHandlerOptions {
  trustProxy?: boolean;
}

export async function buildRequestHandler(
  config: PfortnerConfig,
  infra: InfraContext,
  registry: PluginRegistry,
  hooks?: RequestHandlerHooks,
  options: RequestHandlerOptions = {},
): Promise<RequestHandler> {
  // existing resolver setup
  return (req, conn) => {
    const guard = evaluateRuntimeGuards({ config, hooks, req, conn, trustProxy: options.trustProxy });
    // existing body
  };
}
```

Export `RequestHandlerOptions` from `src/config/starter.ts`.

- [ ] **Step 4: starter regression を追加する**

Append to `src/config/starter.test.ts`:

```ts
Deno.test('buildRequestHandler passes trustProxy option into runtime guards', async () => {
  const config = loadConfigFromString(`
server:
  upstream_relay: "ws://localhost:7777"
  x_forwarded_for: false
pipelines:
  client: []
  server: []
`);
  const handler = await buildRequestHandler(config, buildInfraContext(), createPluginRegistry(), undefined, {
    trustProxy: true,
  });
  const req = new Request('http://localhost/', {
    headers: {
      upgrade: 'websocket',
      'x-forwarded-for': '203.0.113.55',
    },
  });
  const conn = { remoteAddr: { hostname: '10.0.0.5', port: 1234, transport: 'tcp' } } as Deno.ServeHandlerInfo<
    Deno.NetAddr
  >;
  const res = await handler(req, conn);
  assertEquals(res.status, 400);
});
```

If this test cannot inspect client IP directly, keep the runtime guard unit test as the behavioral proof and add a source gate:

```ts
Deno.test('buildRequestHandler forwards trustProxy option to evaluateRuntimeGuards', async () => {
  const source = await Deno.readTextFile(new URL('./starter.ts', import.meta.url));
  assertEquals(source.includes('trustProxy: options.trustProxy'), true);
});
```

- [ ] **Step 5: Task 3 verification**

Run:

```bash
deno fmt --check --config deno.json src/config/starter.ts src/config/runtime-guards.ts src/config/runtime-guards.test.ts src/config/starter.test.ts
deno check src/config/starter.ts src/config/runtime-guards.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/config/runtime-guards.test.ts src/config/starter.test.ts
```

Expected: all pass.

- [ ] **Step 6: Task 3 commit**

Run:

```bash
git add src/config/starter.ts src/config/runtime-guards.ts src/config/runtime-guards.test.ts src/config/starter.test.ts
git commit -m "feat: route trust proxy through runtime guards"
```

## Task 4: Admin Auth State And Runtime Read Model

**Files:**

- Modify: `src/admin/state.ts`
- Create: `src/admin/read_models/runtime.ts`
- Modify: `src/admin/server.ts`
- Modify: `admin/http/auth_middleware.ts`
- Modify: `admin/http/login_routes.ts`
- Modify: `admin/http/api_routes.ts`
- Modify: `admin/client/fresh_nav.js`
- Test: `src/admin/server.test.ts`
- Test: `src/admin/main_csrf.test.ts`
- Test: `admin/api_routes.test.ts`
- Test: `admin/static/fresh_nav.test.js`

- [ ] **Step 1: failing state/read model tests を追加する**

Append to `src/admin/service.test.ts`:

```ts
Deno.test('getRuntimeInfo returns logging and trust proxy without secrets', () => {
  const state = makeState();
  state.runtime = {
    logging: { level: 'warn', format: 'json' },
    trustProxy: true,
    admin: { enabled: true, tokenSource: 'file' },
  };
  const info = getRuntimeInfo(state);
  assertEquals(info.logging, { level: 'warn', format: 'json' });
  assertEquals(info.trust_proxy, true);
  assertEquals(info.admin, { enabled: true, token_source: 'file' });
  assertEquals('token' in JSON.stringify(info), false);
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/service.test.ts
```

Expected: FAIL because `getRuntimeInfo` does not exist.

- [ ] **Step 2: admin state types を追加する**

Modify `src/admin/state.ts`:

```ts
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
```

Add to `AdminServiceState`:

```ts
adminAuth: AdminAuthState;
runtime: AdminRuntimeState;
```

Update tests' `makeState()` helpers to provide:

```ts
adminAuth: { enabled: true, path: '/admin', token: 'test-token', tokenSource: 'env' },
runtime: {
  logging: { level: 'info', format: 'text' },
  trustProxy: false,
  admin: { enabled: true, tokenSource: 'env' },
},
```

- [ ] **Step 3: runtime read model を作る**

Create `src/admin/read_models/runtime.ts`:

```ts
import type { AdminServiceState } from '../state.ts';

export function getRuntimeInfo(state: AdminServiceState) {
  return {
    logging: state.runtime.logging,
    trust_proxy: state.runtime.trustProxy,
    admin: state.adminAuth.enabled ? { enabled: true, token_source: state.adminAuth.tokenSource } : { enabled: false },
  };
}
```

Export from `src/admin/service.ts`:

```ts
export { getRuntimeInfo } from './read_models/runtime.ts';
```

- [ ] **Step 4: Bearer handler auth を `state.adminAuth` に移す**

Modify `src/admin/server.ts` auth check:

```ts
if (!state.adminAuth.enabled) {
  return json({ error: 'admin disabled' }, 404);
}
if (!token || token !== state.adminAuth.token) {
  return json({ error: 'unauthorized' }, 401);
}
```

Add `GET /runtime` for Bearer API only if existing Bearer surface needs it. If not needed, keep runtime endpoint Fresh-only.

Update `src/admin/server.test.ts`:

```ts
Deno.test('Bearer admin auth uses runtime adminAuth token', async () => {
  const state = makeState();
  state.config.admin = { enabled: true, auth_token: 'old-token' };
  state.adminAuth = { enabled: true, path: '/admin', token: 'runtime-token', tokenSource: 'env' };
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/health', 'GET', 'runtime-token'));
  assertEquals(res.status, 200);
});
```

- [ ] **Step 5: Fresh auth/login を `state.adminAuth` と `state.runtime.trustProxy` に移す**

Modify `admin/http/auth_middleware.ts`:

```ts
if (!state.adminAuth.enabled) {
  return json({ error: 'admin disabled' }, 404);
}
if (!credential || credential.token !== state.adminAuth.token) {
  // existing unauthorized/redirect behavior
}
if (
  needsCookieCsrfCheck(ctx.req, credential) &&
  !isSameOriginRequest(ctx.req, state.runtime.trustProxy)
) {
  // existing CSRF response
}
```

Modify `admin/http/login_routes.ts`:

```ts
if (!state.adminAuth.enabled) {
  return ctx.render(h(LoginPage as any, { error: 'Admin is disabled' }));
}
if (typeof token === 'string' && token === state.adminAuth.token) {
  // existing login success body
}
```

Update CSRF tests to set `state.runtime.trustProxy`, not `state.config.admin.trust_proxy`.

- [ ] **Step 6: Fresh runtime endpoint と Logs UI を追加する**

Modify `admin/http/api_routes.ts`:

```ts
import { getRuntimeInfo } from '$admin/read_models/runtime.ts';
```

Add route:

```ts
app.get(`${adminPath}/api/runtime`, (_ctx) => {
  return json(getRuntimeInfo(state));
});
```

Modify `admin/client/fresh_nav.js` in `fetchLogsInfoForPage()`:

```js
const [runtimeData, healthData] = await Promise.all([
  fetchJsonOrNull('/admin/api/runtime'),
  fetchJsonOrNull('/admin/api/health/detail'),
]);
const logLevel = runtimeData?.logging?.level || '—';
```

Remove the config endpoint dependency from that function.

- [ ] **Step 7: Task 4 verification**

Run:

```bash
deno fmt --check --config deno.json src/admin/state.ts src/admin/read_models/runtime.ts src/admin/server.ts admin/http/auth_middleware.ts admin/http/login_routes.ts admin/http/api_routes.ts src/admin/server.test.ts src/admin/main_csrf.test.ts admin/api_routes.test.ts src/admin/service.test.ts
deno check src/admin/state.ts src/admin/read_models/runtime.ts src/admin/server.ts admin/http/auth_middleware.ts admin/http/login_routes.ts admin/http/api_routes.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/server.test.ts src/admin/main_csrf.test.ts admin/api_routes.test.ts src/admin/service.test.ts admin/static/fresh_nav.test.js
```

Expected: all pass.

- [ ] **Step 8: Task 4 commit**

Run:

```bash
git add src/admin/state.ts src/admin/read_models/runtime.ts src/admin/service.ts src/admin/server.ts admin/http/auth_middleware.ts admin/http/login_routes.ts admin/http/api_routes.ts admin/client/fresh_nav.js src/admin/server.test.ts src/admin/main_csrf.test.ts admin/api_routes.test.ts src/admin/service.test.ts admin/static/fresh_nav.test.js
git commit -m "feat: move admin auth to runtime state"
```

## Task 5: Setup Mode And Generated Config

**Files:**

- Create: `src/server/bootstrap.ts`
- Create: `src/server/setup_app.ts`
- Test: `src/server/bootstrap.test.ts`
- Test: `src/server/setup_app.test.ts`

- [ ] **Step 1: failing bootstrap tests を追加する**

Create `src/server/bootstrap.test.ts`:

```ts
import { assertEquals, assertRejects } from '@std/assert';
import { parse as parseYaml } from '@std/yaml';
import { buildSetupConfigYaml, detectBootstrapState, saveSetupConfig } from './bootstrap.ts';
import { ensureDataDirLayout } from './data_dir.ts';

Deno.test('detectBootstrapState enters setup mode without creating config.yaml', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  const state = await detectBootstrapState(layout);
  assertEquals(state.mode, 'setup');
  await assertRejects(() => Deno.stat(layout.configPath), Deno.errors.NotFound);
});

Deno.test('buildSetupConfigYaml includes default accept pipelines', () => {
  const yaml = buildSetupConfigYaml({
    upstreamRelay: 'wss://relay.example.com',
    relayName: 'Pfortner Relay',
    relayDescription: '',
  });
  const parsed = parseYaml(yaml) as any;
  assertEquals(parsed.server.upstream_relay, 'wss://relay.example.com');
  assertEquals(parsed.pipelines.client, [{ policy: 'accept' }]);
  assertEquals(parsed.pipelines.server, [{ policy: 'accept' }]);
});

Deno.test('saveSetupConfig writes config atomically after validation', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  await saveSetupConfig(layout, {
    upstreamRelay: 'wss://relay.example.com',
    relayName: 'Pfortner Relay',
    relayDescription: '',
  }, { backend: { kvAvailable: true, redisAvailable: false } });
  const written = await Deno.readTextFile(layout.configPath);
  const parsed = parseYaml(written) as any;
  assertEquals(parsed.pipelines.client[0].policy, 'accept');
});
```

Run:

```bash
deno test --allow-read --allow-write src/server/bootstrap.test.ts
```

Expected: FAIL because `src/server/bootstrap.ts` does not exist.

- [ ] **Step 2: bootstrap helpers を実装する**

Create `src/server/bootstrap.ts`:

```ts
import { stringify } from '@std/yaml';
import type { DataDirLayout } from './data_dir.ts';
import type { RuntimeBackendAvailability } from '../config/loader.ts';
import { loadProductionConfigFromString } from '../config/loader.ts';

export type BootstrapState = { mode: 'setup' } | { mode: 'normal'; configPath: string };

export interface SetupConfigInput {
  upstreamRelay: string;
  relayName: string;
  relayDescription: string;
}

export async function detectBootstrapState(layout: DataDirLayout): Promise<BootstrapState> {
  try {
    const stat = await Deno.stat(layout.configPath);
    if (stat.isFile) return { mode: 'normal', configPath: layout.configPath };
    throw new Error(`${layout.configPath} exists but is not a file`);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { mode: 'setup' };
    throw e;
  }
}

export function buildSetupConfigYaml(input: SetupConfigInput): string {
  return stringify({
    server: { upstream_relay: input.upstreamRelay },
    relay_info: {
      name: input.relayName || 'Pfortner Relay',
      description: input.relayDescription || '',
    },
    pipelines: {
      client: [{ policy: 'accept' }],
      server: [{ policy: 'accept' }],
    },
  });
}

export async function saveSetupConfig(
  layout: DataDirLayout,
  input: SetupConfigInput,
  runtime: { backend: RuntimeBackendAvailability },
): Promise<void> {
  const yaml = buildSetupConfigYaml(input);
  loadProductionConfigFromString(yaml, runtime);
  const tmp = `${layout.configPath}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, yaml);
  await Deno.rename(tmp, layout.configPath);
}
```

- [ ] **Step 3: setup app route tests を追加する**

Create `src/server/setup_app.test.ts`:

```ts
import { assertEquals } from '@std/assert';
import { createSetupHandler } from './setup_app.ts';
import { ensureDataDirLayout } from './data_dir.ts';

Deno.test('setup handler serves setup page on /admin', async () => {
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({ layout, runtime: { backend: { kvAvailable: true, redisAvailable: false } } });
  const res = await handler(new Request('http://localhost/admin'));
  assertEquals(res.status, 200);
  assertEquals((await res.text()).includes('Pfortner Setup'), true);
});

Deno.test('setup handler saves complete config', async () => {
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({ layout, runtime: { backend: { kvAvailable: true, redisAvailable: false } } });
  const res = await handler(
    new Request('http://localhost/admin/setup', {
      method: 'POST',
      body: new URLSearchParams({
        upstream_relay: 'wss://relay.example.com',
        relay_name: 'Pfortner Relay',
        relay_description: '',
      }),
    }),
  );
  assertEquals(res.status, 303);
  assertEquals(await Deno.readTextFile(layout.configPath).then((text) => text.includes('pipelines:')), true);
});
```

Run:

```bash
deno test --allow-read --allow-write src/server/setup_app.test.ts
```

Expected: FAIL because `src/server/setup_app.ts` does not exist.

- [ ] **Step 4: setup handler を実装する**

Create `src/server/setup_app.ts`:

```ts
import type { DataDirLayout } from './data_dir.ts';
import type { RuntimeBackendAvailability } from '../config/loader.ts';
import { saveSetupConfig } from './bootstrap.ts';

export function createSetupHandler(options: {
  layout: DataDirLayout;
  runtime: { backend: RuntimeBackendAvailability };
}): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
      return new Response(renderSetupPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (req.method === 'POST' && url.pathname === '/admin/setup') {
      const form = await req.formData();
      const upstreamRelay = String(form.get('upstream_relay') ?? '').trim();
      if (!upstreamRelay) return new Response(renderSetupPage('upstream_relay is required'), { status: 400 });
      await saveSetupConfig(options.layout, {
        upstreamRelay,
        relayName: String(form.get('relay_name') ?? 'Pfortner Relay'),
        relayDescription: String(form.get('relay_description') ?? ''),
      }, options.runtime);
      return new Response(null, { status: 303, headers: { Location: '/admin/' } });
    }
    return new Response('Not Found', { status: 404 });
  };
}

function renderSetupPage(error = ''): string {
  return `<!doctype html>
<html><head><title>Pfortner Setup</title></head>
<body>
<main>
<h1>Pfortner Setup</h1>
${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/admin/setup">
<label>Upstream relay <input name="upstream_relay" required></label>
<label>Relay name <input name="relay_name" value="Pfortner Relay"></label>
<label>Description <input name="relay_description"></label>
<button type="submit">Save</button>
</form>
</main>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
```

- [ ] **Step 5: Task 5 verification**

Run:

```bash
deno fmt --check --config deno.json src/server/bootstrap.ts src/server/setup_app.ts src/server/bootstrap.test.ts src/server/setup_app.test.ts
deno check src/server/bootstrap.ts src/server/setup_app.ts
deno test --allow-read --allow-write src/server/bootstrap.test.ts src/server/setup_app.test.ts
```

Expected: all pass.

- [ ] **Step 6: Task 5 commit**

Run:

```bash
git add src/server/bootstrap.ts src/server/setup_app.ts src/server/bootstrap.test.ts src/server/setup_app.test.ts
git commit -m "feat: add server setup bootstrap"
```

## Task 6: Production Runtime And Main Handler

**Files:**

- Create: `src/server/runtime.ts`
- Create: `src/server/handler.ts`
- Create: `src/server/main.ts`
- Test: `src/server/handler.test.ts`
- Test: `src/server/runtime.test.ts`

- [ ] **Step 1: handler tests を追加する**

Create `src/server/handler.test.ts`:

```ts
import { assertEquals } from '@std/assert';
import { createMainHandler } from './handler.ts';

Deno.test('main handler returns setup_required health in setup mode', async () => {
  const handler = createMainHandler({
    mode: 'setup',
    setupHandler: async () => new Response('setup'),
  });
  const res = await handler(new Request('http://localhost/health'), fakeConn());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: 'setup_required' });
});

Deno.test('main handler delegates /admin to setup handler in setup mode', async () => {
  const handler = createMainHandler({
    mode: 'setup',
    setupHandler: async () => new Response('setup ok'),
  });
  const res = await handler(new Request('http://localhost/admin'), fakeConn());
  assertEquals(await res.text(), 'setup ok');
});

Deno.test('main handler returns setup_required for websocket before config exists', async () => {
  const handler = createMainHandler({
    mode: 'setup',
    setupHandler: async () => new Response('setup'),
  });
  const res = await handler(new Request('http://localhost/', { headers: { upgrade: 'websocket' } }), fakeConn());
  assertEquals(res.status, 503);
  assertEquals(await res.text(), 'setup_required');
});

function fakeConn(): Deno.ServeHandlerInfo<Deno.NetAddr> {
  return { remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 12345 } } as Deno.ServeHandlerInfo<
    Deno.NetAddr
  >;
}
```

Run:

```bash
deno test --allow-read src/server/handler.test.ts
```

Expected: FAIL because `src/server/handler.ts` does not exist.

- [ ] **Step 2: main handler を実装する**

Create `src/server/handler.ts`:

```ts
import { buildRelayInfo } from '../config/relay-info.ts';
import type { PfortnerConfig } from '../config/loader.ts';
import type { PrometheusMetrics } from '../infra/prometheus.ts';

type ServeInfo = Deno.ServeHandlerInfo<Deno.NetAddr>;

export type MainHandlerRuntime =
  | {
    mode: 'setup';
    setupHandler: (req: Request) => Promise<Response>;
  }
  | {
    mode: 'normal';
    config: PfortnerConfig;
    adminEnabled: boolean;
    adminHandler?: (req: Request) => Promise<Response>;
    prometheusMetrics?: PrometheusMetrics;
    health: () => unknown;
    relayHandler: (req: Request, conn: ServeInfo) => Response | Promise<Response>;
  };

export function createMainHandler(runtime: MainHandlerRuntime): (req: Request, conn: ServeInfo) => Promise<Response> {
  return async (req, conn) => {
    const url = new URL(req.url);
    if (runtime.mode === 'setup') {
      if (url.pathname.startsWith('/admin')) return await runtime.setupHandler(req);
      if (url.pathname === '/health') return json({ status: 'setup_required' });
      if (req.headers.get('upgrade') === 'websocket') return new Response('setup_required', { status: 503 });
      if (req.headers.get('accept') === 'application/nostr+json') {
        return new Response('setup_required', { status: 503 });
      }
      return new Response('Please complete setup in /admin.', { status: 503 });
    }

    if (runtime.adminEnabled && runtime.adminHandler && url.pathname.startsWith('/admin')) {
      return await runtime.adminHandler(req);
    }
    if (url.pathname === '/health') return json(runtime.health());
    if (runtime.prometheusMetrics && url.pathname === '/metrics') {
      return new Response(runtime.prometheusMetrics.render(), {
        headers: { 'Content-Type': 'text/plain; version=0.0.4' },
      });
    }
    if (req.headers.get('accept') === 'application/nostr+json') {
      return json(buildRelayInfo(runtime.config), 200, { 'Access-Control-Allow-Origin': '*' });
    }
    if (req.headers.get('upgrade') !== 'websocket') {
      return new Response('Please use a Nostr client to connect.', { status: 400 });
    }
    return await runtime.relayHandler(req, conn);
  };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
```

- [ ] **Step 3: runtime composition tests を追加する**

Create `src/server/runtime.test.ts`:

```ts
import { assertEquals } from '@std/assert';
import { createServerRuntime } from './runtime.ts';

Deno.test('createServerRuntime enters setup mode when config is missing', async () => {
  const dataDir = await Deno.makeTempDir();
  const runtime = await createServerRuntime({
    env: new Map([
      ['PFORTNER_DATA_DIR', dataDir],
      ['PFORTNER_ADMIN_TOKEN', 'test-token'],
    ]),
    args: [],
  });
  assertEquals(runtime.mode, 'setup');
});

Deno.test('createServerRuntime fails when admin disabled and config is missing', async () => {
  const dataDir = await Deno.makeTempDir();
  await assertRejects(
    () =>
      createServerRuntime({
        env: new Map([
          ['PFORTNER_DATA_DIR', dataDir],
          ['PFORTNER_ADMIN_ENABLED', 'false'],
        ]),
        args: [],
      }),
    Error,
    'Admin UI is disabled and config.yaml is missing',
  );
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/server/runtime.test.ts
```

Expected: FAIL because `src/server/runtime.ts` does not exist.

- [ ] **Step 4: runtime composition を作る**

Create `src/server/runtime.ts` with these exported entrypoints:

```ts
import { createAdminApp } from '../../admin/main.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import { buildInfraContext } from '../infra/context.ts';
import { LogBuffer } from '../infra/log-buffer.ts';
import { createPrometheusMetrics } from '../infra/prometheus.ts';
import { ConfigManager } from '../config/manager.ts';
import { loadProductionConfigFromString } from '../config/loader.ts';
import { ConnectionManager } from '../connections/manager.ts';
import { ShutdownManager } from '../shutdown/manager.ts';
import { UpstreamProbe } from '../connections/upstream-probe.ts';
import { UpstreamPool } from '../upstream/pool.ts';
import { pipelineDraftPathForConfig } from '../admin/pipeline_draft.ts';
import type { AdminState } from '../admin/server.ts';
import { parseServerEnv } from './env.ts';
import { ensureDataDirLayout } from './data_dir.ts';
import { resolveAdminAuth } from './admin_token.ts';
import { detectBootstrapState } from './bootstrap.ts';
import { createSetupHandler } from './setup_app.ts';
import { createMainHandler } from './handler.ts';

export async function createServerRuntime(options: {
  env?: Pick<Map<string, string>, 'get'>;
  args?: string[];
}) {
  const parsed = parseServerEnv(options.env ?? new Map(Object.entries(Deno.env.toObject())), options.args ?? Deno.args);
  const layout = await ensureDataDirLayout(parsed.dataDir);
  const adminAuth = await resolveAdminAuth({
    enabled: parsed.adminEnabled,
    token: parsed.adminToken,
    tokenFile: parsed.adminTokenFile,
  });
  const runtimeEnvelope = {
    dataDir: parsed.dataDir,
    listen: parsed.listen,
    trustProxy: parsed.trustProxy,
    adminAuth,
    logging: parsed.logging,
    backend: { kv: { path: layout.kvPath } },
  };

  const bootstrap = await detectBootstrapState(layout);
  if (bootstrap.mode === 'setup') {
    if (!parsed.adminEnabled) throw new Error('Admin UI is disabled and config.yaml is missing');
    return {
      mode: 'setup' as const,
      runtime: runtimeEnvelope,
      layout,
      handler: createMainHandler({
        mode: 'setup',
        setupHandler: createSetupHandler({
          layout,
          runtime: { backend: { kvAvailable: true, redisAvailable: false } },
        }),
      }),
    };
  }

  return await createNormalRuntime({ parsed, runtimeEnvelope, layout, configPath: bootstrap.configPath });
}
```

Then implement `createNormalRuntime()` by moving the config-mode composition from `scripts/serve.ts` into focused helper blocks:

- `const yaml = await Deno.readTextFile(configPath);`
- `const config = loadProductionConfigFromString(yaml, { backend: { kvAvailable: true, redisAvailable: parsed.redisUrl != null || parsed.redisUrlFile != null } });`
- `const logBuffer = new LogBuffer(1000);`
- `const prometheusMetrics = config.infra?.metrics?.prometheus?.enabled ? createPrometheusMetrics() : undefined;`
- `const infra = buildInfraContext({ logging: parsed.logging, httpTimeout: config.infra?.http?.default_timeout, httpUserAgent: config.infra?.http?.user_agent, metrics: prometheusMetrics, logSink })`
- always create KV backend from `layout.kvPath` unless Redis env is resolved.
- load external plugins from `config.plugins`.
- create `AdminState` with `adminAuth`, `runtime`, `pipelineDraftPath: layout.pipelineDraftPath`, `configPath`, `reloadFn`.
- create `ConfigManager.create(yaml, infraWithBackend, registry, hooks, { loadConfig: (text) => loadProductionConfigFromString(text, backendAvailability), requestHandlerOptions: { trustProxy: parsed.trustProxy } })`.
- create main handler with `createMainHandler({ mode: 'normal', config, adminEnabled: adminAuth.enabled, adminHandler: adminAuth.enabled ? createAdminApp(adminState) : undefined, prometheusMetrics, health: () => healthPayload, relayHandler: manager.getRequestHandler() })`.

Keep these helpers private in `src/server/runtime.ts` unless tests need them:

```ts
async function resolveRedisUrl(parsed: ParsedServerEnv): Promise<string | undefined> {
  if (parsed.redisUrl) return parsed.redisUrl;
  if (parsed.redisUrlFile) return (await Deno.readTextFile(parsed.redisUrlFile)).trim();
  return undefined;
}
```

- [ ] **Step 5: production main を作る**

Create `src/server/main.ts`:

```ts
import { createServerRuntime } from './runtime.ts';

if (import.meta.main) {
  try {
    const runtime = await createServerRuntime({});
    Deno.serve(
      {
        hostname: runtime.runtime.listen.hostname,
        port: runtime.runtime.listen.port,
      },
      runtime.handler,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}
```

- [ ] **Step 6: Task 6 verification**

Run:

```bash
deno fmt --check --config deno.json src/server/runtime.ts src/server/handler.ts src/server/main.ts src/server/runtime.test.ts src/server/handler.test.ts
deno check src/server/runtime.ts src/server/handler.ts src/server/main.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/server/runtime.test.ts src/server/handler.test.ts
```

Expected: all pass.

- [ ] **Step 7: Task 6 commit**

Run:

```bash
git add src/server/runtime.ts src/server/handler.ts src/server/main.ts src/server/runtime.test.ts src/server/handler.test.ts
git commit -m "feat: add data dir server runtime"
```

## Task 7: Drop Production `scripts/serve.ts` And Rebuild Docker UX

**Files:**

- Modify: `deno.json`
- Modify: `Dockerfile`
- Delete: `scripts/serve.ts`
- Test: `src/server/main.ts`

- [ ] **Step 1: deno task red/source gate を追加する**

Add to a new `src/server/tasks_static.test.ts`:

```ts
import { assertEquals } from '@std/assert';

Deno.test('serve task uses src/server/main.ts', async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(new URL('../../deno.json', import.meta.url)));
  assertEquals(String(denoJson.tasks.serve).includes('src/server/main.ts'), true);
  assertEquals(String(denoJson.tasks.serve).includes('scripts/serve.ts'), false);
});

Deno.test('Dockerfile runs src/server/main.ts and checks /health', async () => {
  const dockerfile = await Deno.readTextFile(new URL('../../Dockerfile', import.meta.url));
  assertEquals(dockerfile.includes('src/server/main.ts'), true);
  assertEquals(dockerfile.includes('http://localhost:3000/health'), true);
  assertEquals(dockerfile.includes('VOLUME ["/data"]') || dockerfile.includes('VOLUME /data'), true);
});
```

Run:

```bash
deno test --allow-read src/server/tasks_static.test.ts
```

Expected: FAIL because tasks/Dockerfile still point at `scripts/serve.ts`.

- [ ] **Step 2: deno tasks を更新する**

Modify `deno.json` tasks:

```json
"dev": "deno run --unstable-net --allow-env --allow-net --allow-read --allow-write --watch src/server/main.ts",
"dev:admin": "deno task dev",
"serve": "deno run --unstable-net --allow-env --allow-net --allow-read --allow-write src/server/main.ts",
"build:admin-assets": "deno run --allow-env --allow-read --allow-write --allow-run scripts/build_admin_islands.ts",
"test": "deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/ src/"
```

Remove `serve:config`.

- [ ] **Step 3: Dockerfile を更新する**

Replace `Dockerfile` with:

```dockerfile
FROM denoland/deno:2.8.3

WORKDIR /app

COPY --chown=deno deno.json deno.lock* ./
COPY --chown=deno src ./src
COPY --chown=deno admin ./admin
COPY --chown=deno scripts ./scripts

RUN deno cache src/server/main.ts scripts/build_admin_islands.ts
RUN deno task build:admin-assets

USER deno
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD deno eval "const res = await fetch('http://localhost:3000/health'); if (!res.ok) Deno.exit(1);"

CMD ["task", "serve"]
```

If `deno.lock` is absent, remove it from COPY or use separate COPY lines.

- [ ] **Step 4: `scripts/serve.ts` production path を落とす**

Delete `scripts/serve.ts`:

```bash
git rm scripts/serve.ts
```

Do not keep a configPath parsing wrapper. Any test or doc that imports `scripts/serve.ts` must be updated in the same task to point at `src/server/main.ts`.

- [ ] **Step 5: Task 7 verification**

Run:

```bash
deno fmt --check --config deno.json deno.json Dockerfile src/server/tasks_static.test.ts
deno test --allow-read src/server/tasks_static.test.ts
deno check src/server/main.ts
```

Expected: all pass.

- [ ] **Step 6: Task 7 commit**

Run:

```bash
git add deno.json Dockerfile src/server/tasks_static.test.ts
git add -u scripts/serve.ts
git commit -m "build: run server from data dir entrypoint"
```

## Task 8: Admin UI Relocation To `src/admin/ui`

**Files:**

- Move: `admin/app` -> `src/admin/ui/app`
- Move: `admin/http` -> `src/admin/ui/http`
- Move: `admin/pages` -> `src/admin/ui/pages`
- Move: `admin/routes` -> `src/admin/ui/routes`
- Move: `admin/components` -> `src/admin/ui/components`
- Move: `admin/islands` -> `src/admin/ui/islands`
- Move: `admin/client` -> `src/admin/ui/client`
- Move: `admin/static` -> `src/admin/ui/static`
- Modify: `admin/main.ts` or delete after imports are updated
- Modify: `scripts/build_admin_islands.ts`
- Modify: `deno.json`
- Modify tests under `admin/` to new paths or move them under `src/admin/ui/`

- [ ] **Step 1: relocation boundary test を追加する**

Create `src/admin/ui_import_boundary.test.ts`:

```ts
import { assertEquals } from '@std/assert';

Deno.test('production source does not import root admin implementation', async () => {
  const offenders: string[] = [];
  for await (const file of walkTs(new URL('../', import.meta.url))) {
    const source = await Deno.readTextFile(file);
    if (
      source.includes("from '../../admin/") || source.includes("from '../admin/") || source.includes("from './admin/")
    ) {
      offenders.push(file);
    }
  }
  assertEquals(offenders, []);
});

async function* walkTs(root: URL): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const url = new URL(entry.name, root);
    if (entry.isDirectory) {
      if (entry.name === 'static') continue;
      yield* walkTs(new URL(`${entry.name}/`, root));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      yield url.pathname;
    }
  }
}
```

Run:

```bash
deno test --allow-read src/admin/ui_import_boundary.test.ts
```

Expected: FAIL until imports and root admin source are moved.

- [ ] **Step 2: move files with git mv**

Run:

```bash
mkdir -p src/admin/ui
git mv admin/app src/admin/ui/app
git mv admin/http src/admin/ui/http
git mv admin/pages src/admin/ui/pages
git mv admin/routes src/admin/ui/routes
git mv admin/components src/admin/ui/components
git mv admin/islands src/admin/ui/islands
git mv admin/client src/admin/ui/client
git mv admin/static src/admin/ui/static
git mv admin/main.ts src/admin/ui/main.ts
git mv admin/security.ts src/admin/ui/security.ts
git mv admin/static_files.ts src/admin/ui/static_files.ts
git mv admin/route_types.ts src/admin/ui/route_types.ts
git mv admin/fresh_islands.ts src/admin/ui/fresh_islands.ts
git mv admin/api_routes.ts src/admin/ui/api_routes.ts
git mv admin/page_routes.ts src/admin/ui/page_routes.ts
git rm admin/deno.json admin/deno.lock
```

Move tests next to their new modules where practical:

```bash
git mv admin/main.test.ts src/admin/ui/main.test.ts
git mv admin/page_routes.test.ts src/admin/ui/page_routes.test.ts
git mv admin/api_routes.test.ts src/admin/ui/api_routes.test.ts
git mv admin/security.test.ts src/admin/ui/security.test.ts
git mv admin/static_files.test.ts src/admin/ui/static_files.test.ts
git mv admin/import_boundary.test.ts src/admin/ui/import_boundary.test.ts
```

- [ ] **Step 3: update imports and aliases**

Update `deno.json` imports:

```json
"$admin/": "./src/admin/",
"$admin-ui/": "./src/admin/ui/"
```

Update moved UI imports:

- `$admin/server.ts` remains service/domain import.
- Relative imports inside moved UI files should continue to use local `../` paths after move.
- Imports from root `admin/*` must become `$admin-ui/*` or relative paths.

Update `src/server/runtime.ts`:

```ts
import { createAdminApp } from '../admin/ui/main.ts';
```

Replace moved `src/admin/ui/main.ts` with:

```ts
export { createAdminApp } from './app/create_admin_app.ts';
```

- [ ] **Step 4: update asset build script**

Modify `scripts/build_admin_islands.ts` defaults:

```ts
const DEFAULT_ADMIN_CLIENT_ENTRY_SOURCE = new URL('../src/admin/ui/client/fresh_nav.js', import.meta.url);
const DEFAULT_ADMIN_CLIENT_ENTRY_OUTPUT = new URL('../src/admin/ui/static/fresh_nav.js', import.meta.url);
const DEFAULT_PIPELINE_WORKBENCH_ENTRY = new URL(
  '../src/admin/ui/islands/PipelineWorkbench.browser.tsx',
  import.meta.url,
);
const DEFAULT_PIPELINE_WORKBENCH_OUTPUT = new URL(
  '../src/admin/ui/static/islands/PipelineWorkbench.js',
  import.meta.url,
);
const GENERATED_ADMIN_CLIENT_ENTRY_BANNER =
  '// Generated from src/admin/ui/client/fresh_nav.js by scripts/build_admin_islands.ts.\n';
```

Update `src/admin/ui/app/create_admin_app.ts`:

```ts
const STATIC_DIR = new URL('../static', import.meta.url).pathname;
```

This relative path stays correct after move if `app/` and `static/` are siblings under `src/admin/ui/`.

- [ ] **Step 5: update lint/test config**

Modify `deno.json` lint exclude:

```json
"exclude": [
  "src/admin/ui/static/"
]
```

Modify `deno.json` test task:

```json
"test": "deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/"
```

- [ ] **Step 6: remove root admin directory**

After the moves above, remove the empty root `admin/` directory and make source/tests import `src/admin/ui/*` directly. If `git status --short admin` still shows files, move source files under `src/admin/ui/` or delete generated/obsolete metadata in this task.

```bash
rmdir admin
```

- [ ] **Step 7: Task 8 verification**

Run:

```bash
deno fmt --check --config deno.json src/admin/ui scripts/build_admin_islands.ts deno.json src/admin/ui_import_boundary.test.ts
deno lint --config deno.json
deno check src/admin/ui/main.ts src/server/runtime.ts scripts/build_admin_islands.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/ui/ src/admin/ui_import_boundary.test.ts src/admin/
deno task build:admin-assets
```

Expected: all pass. Generated files should land under `src/admin/ui/static/`.

- [ ] **Step 8: Task 8 commit**

Run:

```bash
git add deno.json scripts/build_admin_islands.ts src/admin/ui src/admin/ui_import_boundary.test.ts src/server/runtime.ts
git add -u admin
git commit -m "refactor: move admin ui under src"
```

## Task 9: Docs And Full Verification

**Files:**

- Modify: `docs/current-architecture.md`
- Modify: `docs/superpowers/specs/2026-06-13-pfortner-server-docker-bootstrap-design.md` only if implementation reveals a necessary correction

- [ ] **Step 1: update architecture docs**

Update `docs/current-architecture.md` sections:

- Config Bootstrap becomes Server Runtime and points to `src/server/main.ts`, `runtime.ts`, `env.ts`, `data_dir.ts`, `bootstrap.ts`, `handler.ts`.
- Admin UI source points to `src/admin/ui/*`.
- `src/admin/read_models/runtime.ts` is listed.
- Production config is dataDir-owned at `/data/config.yaml`.
- `scripts/serve.ts` is no longer production entrypoint.
- Docker image owns `/data` volume and includes Admin UI assets.

- [ ] **Step 2: final targeted verification**

Run:

```bash
deno fmt --check --config deno.json
deno lint --config deno.json
deno check mod.ts src/server/main.ts src/admin/server.ts src/admin/ui/main.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/server/ src/config/ src/admin/
deno task build:admin-assets
```

Expected: all pass.

- [ ] **Step 3: full test verification**

Run:

```bash
deno task test
```

Expected: all pass. If socket bind is blocked by the execution environment, record the exact bind error and rerun targeted tests from Step 2 to separate environment failure from code regression.

- [ ] **Step 4: Docker static verification**

Run:

```bash
docker build -t pfortner-server:bootstrap-plan .
```

Expected: image builds and `deno task build:admin-assets` runs during build.

- [ ] **Step 5: docs commit**

Run:

```bash
git add docs/current-architecture.md docs/superpowers/specs/2026-06-13-pfortner-server-docker-bootstrap-design.md
git commit -m "docs: update server bootstrap architecture"
```

## Final Acceptance Checklist

- [ ] `deno task serve` starts `src/server/main.ts`.
- [ ] Empty dataDir with admin enabled enters setup mode and does not create `config.yaml`.
- [ ] Setup save creates complete production YAML with `pipelines.client` and `pipelines.server`.
- [ ] Admin disabled with missing config fails fast without reading or generating token.
- [ ] Existing `/data/admin-token` is reused across restart.
- [ ] Production config rejects env-owned fields and does not expand `${ENV}` placeholders.
- [ ] `PFORTNER_TRUST_PROXY` affects both Admin CSRF and relay client IP selection.
- [ ] Admin auth uses `state.adminAuth`, not `state.config.admin?.auth_token`.
- [ ] Logs page reads log level from runtime projection, not masked config.
- [ ] Redis secret does not appear in masked config or runtime endpoint.
- [ ] Admin UI source lives under `src/admin/ui/*`; generated assets are under `src/admin/ui/static/*`.
- [ ] Dockerfile exposes `/data`, runs `src/server/main.ts`, builds Admin UI assets, and healthchecks `/health`.
