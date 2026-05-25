import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { nostrTools } from './deps.ts';
import { pfortnerInit } from './pfortner.ts';
import { acceptPolicy } from './policies/AcceptPolicy.ts';
import { kindFilterPlugin } from './policies/KindFilterPolicy.ts';
import { buildInfraContext } from './infra/context.ts';

const sk = nostrTools.generateSecretKey();

function currUnixtime(): number {
  return Math.floor(Date.now() / 1000);
}

function makeAuthEvent(
  challenge: string,
  relayUrl: string,
  createdAt?: number,
): nostrTools.VerifiedEvent {
  return nostrTools.finalizeEvent({
    kind: 22242,
    created_at: createdAt ?? currUnixtime(),
    tags: [
      ['challenge', challenge],
      ['relay', relayUrl],
    ],
    content: '',
  }, sk);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  message: string,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await delay(intervalMs);
  }
  if (condition()) {
    return;
  }
  throw new Error(message);
}

async function createEnv(opts: Record<string, unknown> = {}) {
  const upstreamMessages: string[] = [];

  // Mock upstream relay
  const relayAc = new AbortController();
  const relayPort = await new Promise<number>((resolve) => {
    Deno.serve({
      port: 0,
      signal: relayAc.signal,
      onListen({ port }) {
        resolve(port);
      },
    }, (req) => {
      if (req.headers.get('upgrade') === 'websocket') {
        const { socket, response } = Deno.upgradeWebSocket(req);
        socket.addEventListener('message', ({ data }) => {
          upstreamMessages.push(data as string);
        });
        return response;
      }
      return new Response('ok');
    });
  });

  const upstreamUrl = `ws://127.0.0.1:${relayPort}`;

  const proxy = pfortnerInit(upstreamUrl, {
    sendAuthOnConnect: true,
    upstreamRawAddress: upstreamUrl,
    ...opts,
  });

  // Proxy server
  const proxyAc = new AbortController();
  const proxyPort = await new Promise<number>((resolve) => {
    Deno.serve({
      port: 0,
      signal: proxyAc.signal,
      onListen({ port }) {
        resolve(port);
      },
    }, (req) => proxy.createSession(req));
  });

  // Connect client WebSocket and receive AUTH challenge
  const { ws, challenge } = await new Promise<{ ws: WebSocket; challenge: string }>(
    (resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
      ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data as string);
          if (msg[0] === 'AUTH') {
            resolve({ ws, challenge: msg[1] });
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => reject(new Error('Client WebSocket connection failed'));
      setTimeout(() => reject(new Error('Timeout waiting for AUTH challenge')), 5000);
    },
  );

  return {
    proxy,
    proxyPort,
    ws,
    challenge,
    upstreamUrl,
    upstreamMessages,
    async cleanup() {
      ws.close();
      proxy.closeSocket();
      proxyAc.abort();
      relayAc.abort();
      await delay(100);
    },
  };
}

function sendAuth(
  ws: WebSocket,
  proxy: ReturnType<typeof pfortnerInit>,
  event: nostrTools.VerifiedEvent,
): Promise<'success' | 'failed'> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      proxy.off('authSuccess', onSuccess);
      proxy.off('authFailed', onFailed);
      resolve('failed');
    }, 3000);

    function onSuccess() {
      clearTimeout(timeout);
      proxy.off('authFailed', onFailed);
      resolve('success');
    }

    function onFailed() {
      clearTimeout(timeout);
      proxy.off('authSuccess', onSuccess);
      resolve('failed');
    }

    proxy.on('authSuccess', onSuccess);
    proxy.on('authFailed', onFailed);
    ws.send(JSON.stringify(['AUTH', event]));
  });
}

Deno.test({
  name: 'createSession: rejects a second WebSocket on the same proxy instance',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv();
    const secondMessages: string[] = [];
    let secondClosed = false;
    let secondErrored = false;
    const second = new WebSocket(`ws://127.0.0.1:${env.proxyPort}`);
    second.onmessage = ({ data }) => secondMessages.push(data as string);
    second.onclose = () => {
      secondClosed = true;
    };
    second.onerror = () => {
      secondErrored = true;
    };

    try {
      await waitFor(
        () => secondClosed || secondErrored || secondMessages.length > 0,
        1000,
        'second WebSocket did not settle',
      );

      assertEquals(secondClosed || secondErrored, true);
      assertEquals(secondMessages, []);
    } finally {
      second.close();
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'client message handler: rejects malformed three-element EVENT before policy forwarding',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv();
    try {
      const factory = await kindFilterPlugin.initialize(
        { mode: 'deny', kinds: [4], require_auth_for: [4] },
        buildInfraContext({}),
      );
      const kindFilter = factory(env.proxy);
      env.proxy.registerClientPipeline([kindFilter, acceptPolicy]);
      const clientMessages: string[] = [];
      env.ws.onmessage = ({ data }) => {
        clientMessages.push(data as string);
      };

      const forbiddenEvent = { id: 'forbidden', pubkey: 'pk', kind: 4, created_at: 0, tags: [], content: '', sig: '' };
      const allowedDummyEvent = { id: 'allowed', pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' };

      env.ws.send(JSON.stringify(['EVENT', forbiddenEvent, allowedDummyEvent]));
      await waitFor(
        () => clientMessages.includes(JSON.stringify(['NOTICE', 'ERROR: bad msg: invalid EVENT message'])),
        1000,
        'client did not receive invalid EVENT NOTICE',
      );

      assertEquals(env.upstreamMessages, []);
      assertEquals(clientMessages, [JSON.stringify(['NOTICE', 'ERROR: bad msg: invalid EVENT message'])]);
    } finally {
      await env.cleanup();
    }
  },
});

// =============================
// AUTH リプレイ攻撃防止
// =============================

Deno.test({
  name: 'verifyAuthMessage: valid AUTH event succeeds',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv();
    try {
      const event = makeAuthEvent(env.challenge, env.upstreamUrl);
      const result = await sendAuth(env.ws, env.proxy, event);
      assertEquals(result, 'success');
      assertEquals(env.proxy.connectionInfo.clientAuthorized, true);
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'client message handler: async listener rejection does not skip pipeline',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    let unhandledRejection = false;
    let policyRan = false;
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      unhandledRejection = true;
      event.preventDefault();
    };
    globalThis.addEventListener('unhandledrejection', onUnhandledRejection);

    const env = await createEnv();
    try {
      env.proxy.on('clientMsg', () => Promise.reject(new Error('clientMsg listener rejected')));
      env.proxy.registerClientPipeline([(_msg) => {
        policyRan = true;
        return { message: _msg, action: 'next' };
      }]);

      env.ws.send(JSON.stringify(['EVENT', { kind: 1 }]));
      await delay(100);

      assertEquals(unhandledRejection, false);
      assertEquals(policyRan, true);

      const event = makeAuthEvent(env.challenge, env.upstreamUrl);
      assertEquals(await sendAuth(env.ws, env.proxy, event), 'success');
    } finally {
      globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'verifyAuthMessage: replay with same event ID is rejected',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv();
    try {
      const event = makeAuthEvent(env.challenge, env.upstreamUrl);
      assertEquals(await sendAuth(env.ws, env.proxy, event), 'success');
      // Same event (same id) should be rejected
      assertEquals(await sendAuth(env.ws, env.proxy, event), 'failed');
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'verifyAuthMessage: new event ID after replay is accepted',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv();
    try {
      const now = currUnixtime();
      const event1 = makeAuthEvent(env.challenge, env.upstreamUrl, now);
      assertEquals(await sendAuth(env.ws, env.proxy, event1), 'success');
      // Replay of event1 should fail
      assertEquals(await sendAuth(env.ws, env.proxy, event1), 'failed');
      // Different event (different created_at → different id) should succeed
      const event2 = makeAuthEvent(env.challenge, env.upstreamUrl, now - 5);
      assertEquals(await sendAuth(env.ws, env.proxy, event2), 'success');
    } finally {
      await env.cleanup();
    }
  },
});

// =============================
// AUTH レートリミット
// =============================

Deno.test({
  name: 'verifyAuthMessage: rejects after maxAuthAttempts exceeded',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv({ maxAuthAttempts: 3 });
    try {
      // 3 invalid AUTH attempts (wrong challenge, each with unique created_at)
      for (let i = 0; i < 3; i++) {
        const badEvent = makeAuthEvent('wrong-challenge', env.upstreamUrl, currUnixtime() - i);
        assertEquals(await sendAuth(env.ws, env.proxy, badEvent), 'failed');
      }
      // 4th attempt: valid but rate limited
      const validEvent = makeAuthEvent(env.challenge, env.upstreamUrl);
      assertEquals(await sendAuth(env.ws, env.proxy, validEvent), 'failed');
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'verifyAuthMessage: succeeds within maxAuthAttempts limit',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv({ maxAuthAttempts: 5 });
    try {
      // 4 invalid attempts
      for (let i = 0; i < 4; i++) {
        const badEvent = makeAuthEvent('wrong-challenge', env.upstreamUrl, currUnixtime() - i);
        assertEquals(await sendAuth(env.ws, env.proxy, badEvent), 'failed');
      }
      // 5th attempt: valid and within limit (5 <= 5)
      const validEvent = makeAuthEvent(env.challenge, env.upstreamUrl);
      assertEquals(await sendAuth(env.ws, env.proxy, validEvent), 'success');
    } finally {
      await env.cleanup();
    }
  },
});

// =============================
// AUTH タイムスタンプ検証
// =============================

Deno.test({
  name: 'verifyAuthMessage: rejects timestamp too far in the past',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv({ allowedAuthTimeDuration: 60 });
    try {
      // 70 seconds ago — outside 60s past window
      const event = makeAuthEvent(env.challenge, env.upstreamUrl, currUnixtime() - 70);
      assertEquals(await sendAuth(env.ws, env.proxy, event), 'failed');
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'verifyAuthMessage: accepts timestamp within past duration',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv({ allowedAuthTimeDuration: 120 });
    try {
      // 60 seconds ago — within 120s past window
      const event = makeAuthEvent(env.challenge, env.upstreamUrl, currUnixtime() - 60);
      assertEquals(await sendAuth(env.ws, env.proxy, event), 'success');
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'verifyAuthMessage: rejects timestamp too far in the future',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv({ allowedAuthFutureTimeDuration: 30 });
    try {
      // 40 seconds in the future — outside 30s future window
      const event = makeAuthEvent(env.challenge, env.upstreamUrl, currUnixtime() + 40);
      assertEquals(await sendAuth(env.ws, env.proxy, event), 'failed');
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'verifyAuthMessage: accepts timestamp within future duration',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv({ allowedAuthFutureTimeDuration: 120 });
    try {
      // 60 seconds in the future — within 120s future window
      const event = makeAuthEvent(env.challenge, env.upstreamUrl, currUnixtime() + 60);
      assertEquals(await sendAuth(env.ws, env.proxy, event), 'success');
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'verifyAuthMessage: future uses allowedAuthFutureTimeDuration not allowedAuthTimeDuration',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Past window: 600s (10 min), future window: 30s
    const env = await createEnv({
      allowedAuthTimeDuration: 600,
      allowedAuthFutureTimeDuration: 30,
    });
    try {
      // 300s past — within 600s past window → success
      const pastEvent = makeAuthEvent(env.challenge, env.upstreamUrl, currUnixtime() - 300);
      assertEquals(await sendAuth(env.ws, env.proxy, pastEvent), 'success');

      // 40s future — outside 30s future window → failed
      const futureEvent = makeAuthEvent(env.challenge, env.upstreamUrl, currUnixtime() + 40);
      assertEquals(await sendAuth(env.ws, env.proxy, futureEvent), 'failed');
    } finally {
      await env.cleanup();
    }
  },
});

// =============================
// 接続ライフサイクル
// =============================

Deno.test({
  name: 'closeSocket: emits clientDisconnect exactly once for local closes',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const env = await createEnv();
    let disconnects = 0;
    env.proxy.on('clientDisconnect', () => {
      disconnects++;
    });

    try {
      env.proxy.closeSocket();
      await delay(100);
      env.proxy.closeSocket();
      await delay(100);

      assertEquals(disconnects, 1);
    } finally {
      await env.cleanup();
    }
  },
});

Deno.test({
  name: 'createSession: closes pending upstream when client disconnects before upstream opens',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    let activeUpstreams = 0;
    let upstreamCloseEvents = 0;
    let upstreamUpgradeReceived = false;
    let releaseUpgrade: () => void = () => {};
    const upgradeGate = new Promise<void>((resolve) => {
      releaseUpgrade = resolve;
    });

    const relayAc = new AbortController();
    const relayPort = await new Promise<number>((resolve) => {
      Deno.serve({
        port: 0,
        signal: relayAc.signal,
        onListen({ port }) {
          resolve(port);
        },
      }, async (req) => {
        if (req.headers.get('upgrade') === 'websocket') {
          upstreamUpgradeReceived = true;
          const { socket, response } = Deno.upgradeWebSocket(req);
          let opened = false;
          socket.addEventListener('open', () => {
            opened = true;
            activeUpstreams++;
          });
          socket.addEventListener('close', () => {
            if (opened) {
              activeUpstreams--;
            }
            upstreamCloseEvents++;
          });
          await upgradeGate;
          return response;
        }
        return new Response('ok');
      });
    });

    const proxy = pfortnerInit(`ws://127.0.0.1:${relayPort}`, {
      sendAuthOnConnect: false,
      idleTimeout: 10,
    });

    const proxyAc = new AbortController();
    const proxyPort = await new Promise<number>((resolve) => {
      Deno.serve({
        port: 0,
        signal: proxyAc.signal,
        onListen({ port }) {
          resolve(port);
        },
      }, (req) => proxy.createSession(req));
    });

    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('Client WebSocket connection failed'));
      });
      await waitFor(() => upstreamUpgradeReceived, 3000, 'Timed out waiting for upstream upgrade request');

      ws.close();
      releaseUpgrade();

      await waitFor(
        () => upstreamCloseEvents > 0 && activeUpstreams === 0,
        3000,
        'Timed out waiting for pending upstream to close',
      );
      assertEquals(activeUpstreams, 0);
    } finally {
      releaseUpgrade();
      ws.close();
      proxy.closeSocket();
      proxyAc.abort();
      relayAc.abort();
      await delay(100);
    }
  },
});

// =============================
// upstream 接続失敗
// =============================

Deno.test({
  name: 'createSession: handles upstream connection failure gracefully',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const proxy = pfortnerInit('ws://127.0.0.1:1', {
      sendAuthOnConnect: false,
    });

    let serverErrorFired = false;
    proxy.on('serverError', () => {
      serverErrorFired = true;
    });

    const proxyAc = new AbortController();
    const proxyPort = await new Promise<number>((resolve) => {
      Deno.serve({
        port: 0,
        signal: proxyAc.signal,
        onListen({ port }) {
          resolve(port);
        },
      }, (req) => proxy.createSession(req));
    });

    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
    const clientClosed = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 3000);
      ws.onclose = () => {
        clearTimeout(timeout);
        resolve(true);
      };
    });
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
      ws.onerror = () => resolve();
    });

    await waitFor(() => serverErrorFired, 3000, 'Timed out waiting for upstream connection failure');

    assertEquals(serverErrorFired, true);
    assertEquals(await clientClosed, true);

    ws.close();
    proxy.closeSocket();
    proxyAc.abort();
    await delay(100);
  },
});
