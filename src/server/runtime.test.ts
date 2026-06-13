import { assertEquals, assertRejects } from '@std/assert';
import { UpstreamProbe } from '../connections/upstream-probe.ts';
import { UpstreamPool } from '../upstream/pool.ts';
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

Deno.test('createServerRuntime enters normal mode without touching admin token file when admin is disabled', async () => {
  const dataDir = await makeConfiguredDataDir();
  const runtime = await createServerRuntime({
    env: new Map([
      ['PFORTNER_DATA_DIR', dataDir],
      ['PFORTNER_ADMIN_ENABLED', 'false'],
    ]),
    args: [],
  });
  try {
    assertEquals(runtime.mode, 'normal');
    assertEquals(runtime.runtime.adminAuth, { enabled: false, path: '/admin' });
    await assertMissing(`${dataDir}/admin-token`);
  } finally {
    if (runtime.mode === 'normal') await runtime.shutdown();
  }
});

Deno.test('createServerRuntime reuses existing default dataDir admin token across restart', async () => {
  const dataDir = await makeConfiguredDataDir();
  await Deno.writeTextFile(`${dataDir}/admin-token`, 'existing-token\n');

  const first = await createServerRuntime({
    env: new Map([['PFORTNER_DATA_DIR', dataDir]]),
    args: [],
  });
  try {
    assertEquals(first.mode, 'normal');
    assertEquals(first.runtime.adminAuth, {
      enabled: true,
      path: '/admin',
      token: 'existing-token',
      tokenSource: 'file',
    });
  } finally {
    if (first.mode === 'normal') await first.shutdown();
  }

  const second = await createServerRuntime({
    env: new Map([['PFORTNER_DATA_DIR', dataDir]]),
    args: [],
  });
  try {
    assertEquals(second.mode, 'normal');
    assertEquals(second.runtime.adminAuth, {
      enabled: true,
      path: '/admin',
      token: 'existing-token',
      tokenSource: 'file',
    });
    assertEquals(await Deno.readTextFile(`${dataDir}/admin-token`), 'existing-token\n');
  } finally {
    if (second.mode === 'normal') await second.shutdown();
  }
});

Deno.test('normal runtime main handler routes /health with status ok', async () => {
  const dataDir = await makeConfiguredDataDir();
  const runtime = await createServerRuntime({
    env: new Map([
      ['PFORTNER_DATA_DIR', dataDir],
      ['PFORTNER_ADMIN_ENABLED', 'false'],
    ]),
    args: [],
  });
  try {
    const res = await runtime.handler(new Request('http://localhost/health'), fakeConn());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { status: 'ok', connections: 0, pressure: 'normal' });
  } finally {
    if (runtime.mode === 'normal') await runtime.shutdown();
  }
});

Deno.test('normal runtime admin metrics throughput returns initialized buckets', async () => {
  const dataDir = await makeConfiguredDataDir();
  const runtime = await createServerRuntime({
    env: new Map([
      ['PFORTNER_DATA_DIR', dataDir],
      ['PFORTNER_ADMIN_TOKEN', 'test-token'],
    ]),
    args: [],
  });
  try {
    const res = await runtime.handler(
      new Request('http://localhost/admin/api/metrics/throughput', {
        headers: { Authorization: 'Bearer test-token' },
      }),
      fakeConn(),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(Array.isArray(body), true);
    assertEquals(body.length, 30);
    assertEquals(typeof body[0].accept, 'number');
    assertEquals(typeof body[0].reject, 'number');
  } finally {
    if (runtime.mode === 'normal') await runtime.shutdown();
  }
});

Deno.test('setup save transitions current process to normal health handler', async () => {
  const dataDir = await Deno.makeTempDir();
  const runtime = await createServerRuntime({
    env: new Map([
      ['PFORTNER_DATA_DIR', dataDir],
      ['PFORTNER_ADMIN_TOKEN', 'test-token'],
    ]),
    args: [],
  });
  try {
    assertEquals(runtime.mode, 'setup');

    const setupRes = await runtime.handler(
      new Request('http://localhost/admin/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: new URLSearchParams({
          upstream_relay: 'ws://127.0.0.1:1',
          relay_name: 'Transition Relay',
          relay_description: 'transitioned',
        }),
      }),
      fakeConn(),
    );
    assertEquals(setupRes.status, 303);

    const healthRes = await runtime.handler(new Request('http://localhost/health'), fakeConn());
    assertEquals(runtime.mode, 'normal');
    assertEquals(healthRes.status, 200);
    assertEquals(await healthRes.json(), { status: 'ok', connections: 0, pressure: 'normal' });

    const nip11Res = await runtime.handler(
      new Request('http://localhost/', { headers: { accept: 'application/nostr+json' } }),
      fakeConn(),
    );
    assertEquals(nip11Res.status, 200);
    assertEquals((await nip11Res.json()).name, 'Transition Relay');
  } finally {
    if ('shutdown' in runtime) await runtime.shutdown();
  }
});

Deno.test('setup save rejects unauthenticated requests before normal transition', async () => {
  const dataDir = await Deno.makeTempDir();
  const runtime = await createServerRuntime({
    env: new Map([
      ['PFORTNER_DATA_DIR', dataDir],
      ['PFORTNER_ADMIN_TOKEN', 'test-token'],
    ]),
    args: [],
  });
  try {
    assertEquals(runtime.mode, 'setup');

    const setupRes = await runtime.handler(
      new Request('http://localhost/admin/setup', {
        method: 'POST',
        body: new URLSearchParams({
          upstream_relay: 'ws://127.0.0.1:1',
          relay_name: 'Transition Relay',
          relay_description: 'transitioned',
        }),
      }),
      fakeConn(),
    );
    assertEquals(setupRes.status, 401);
    assertEquals(runtime.mode, 'setup');
    await assertMissing(`${dataDir}/config.yaml`);
  } finally {
    if ('shutdown' in runtime) await runtime.shutdown();
  }
});

Deno.test('normal runtime starts upstream probe', async () => {
  const originalStart = UpstreamProbe.prototype.start;
  const originalStop = UpstreamProbe.prototype.stop;
  let started = 0;
  let stopped = 0;
  UpstreamProbe.prototype.start = function () {
    started++;
  };
  UpstreamProbe.prototype.stop = function () {
    stopped++;
  };

  const dataDir = await makeConfiguredDataDir();
  const runtime = await createServerRuntime({
    env: new Map([
      ['PFORTNER_DATA_DIR', dataDir],
      ['PFORTNER_ADMIN_ENABLED', 'false'],
    ]),
    args: [],
  });
  try {
    assertEquals(runtime.mode, 'normal');
    assertEquals(started, 1);
  } finally {
    if ('shutdown' in runtime) await runtime.shutdown();
    UpstreamProbe.prototype.start = originalStart;
    UpstreamProbe.prototype.stop = originalStop;
  }
  assertEquals(stopped, 1);
});

Deno.test('createServerRuntime cleans partial normal resources when config manager creation fails', async () => {
  const originalProbeStart = UpstreamProbe.prototype.start;
  const originalProbeStop = UpstreamProbe.prototype.stop;
  const originalPoolCloseAll = UpstreamPool.prototype.closeAll;
  let probeStarted = 0;
  let probeStopped = 0;
  let poolClosed = 0;

  UpstreamProbe.prototype.start = function () {
    probeStarted++;
  };
  UpstreamProbe.prototype.stop = function () {
    probeStopped++;
  };
  UpstreamPool.prototype.closeAll = function () {
    poolClosed++;
  };

  const dataDir = await makeConfiguredDataDir(unknownPolicyConfigYaml());
  try {
    await assertRejects(
      () =>
        createServerRuntime({
          env: new Map([
            ['PFORTNER_DATA_DIR', dataDir],
            ['PFORTNER_ADMIN_TOKEN', 'test-token'],
          ]),
          args: [],
        }),
      Error,
      'Unknown plugin: "missing-policy"',
    );
  } finally {
    UpstreamProbe.prototype.start = originalProbeStart;
    UpstreamProbe.prototype.stop = originalProbeStop;
    UpstreamPool.prototype.closeAll = originalPoolCloseAll;
  }

  assertEquals(probeStarted, 0);
  assertEquals(probeStopped, 0);
  assertEquals(poolClosed, 1);
});

async function makeConfiguredDataDir(yaml = productionConfigYaml()): Promise<string> {
  const dataDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dataDir}/config.yaml`, yaml);
  return dataDir;
}

function productionConfigYaml(): string {
  return `server:
  upstream_relay: ws://127.0.0.1:1
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`;
}

function unknownPolicyConfigYaml(): string {
  return `server:
  upstream_relay: ws://127.0.0.1:1
pipelines:
  client:
    - policy: missing-policy
  server:
    - policy: accept
`;
}

async function assertMissing(path: string): Promise<void> {
  await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
}

function fakeConn(): Deno.ServeHandlerInfo<Deno.NetAddr> {
  return { remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 12345 } } as Deno.ServeHandlerInfo<
    Deno.NetAddr
  >;
}
