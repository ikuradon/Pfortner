import { log, nostrTools } from './deps.ts';

type SocketEvent = {
  authSuccess: (event: nostrTools.Event) => void | Promise<void>;
  authFailed: () => void | Promise<void>;

  clientConnect: () => void | Promise<void>;
  clientDisconnect: () => void | Promise<void>;
  clientError: () => void | Promise<void>;
  clientMsg: (message: string) => void | Promise<void>;
  clientAuth: (event: nostrTools.Event) => void | Promise<void>;
  clientEvent: (event: nostrTools.Event) => void | Promise<void>;
  clientRequest: (subscriptionId: string, filter: nostrTools.Filter) => void | Promise<void>;
  clientClose: (subscriptionId: string) => void | Promise<void>;

  serverConnect: () => void | Promise<void>;
  serverDisconnect: () => void | Promise<void>;
  serverError: () => void | Promise<void>;
  serverMsg: (message: string) => void | Promise<void>;
  serverEvent: (subscriptionId: string, event: nostrTools.Event) => void | Promise<void>;
  serverOk: (eventId: string, isPublished: boolean, message: string) => void | Promise<void>;
  serverEose: (subscriptionId: string) => void | Promise<void>;
  serverClosed: (subscriptionId: string, message: string) => void | Promise<void>;
  serverNotice: (message: string) => void | Promise<void>;
};

const newListeners = (): { [TK in keyof SocketEvent]: SocketEvent[TK][] } => ({
  authSuccess: [],
  authFailed: [],

  clientConnect: [],
  clientDisconnect: [],
  clientError: [],
  clientMsg: [],
  clientAuth: [],
  clientEvent: [],
  clientRequest: [],
  clientClose: [],

  serverConnect: [],
  serverDisconnect: [],
  serverError: [],
  serverMsg: [],
  serverEvent: [],
  serverOk: [],
  serverEose: [],
  serverClosed: [],
  serverNotice: [],
});

export interface OutputMessage {
  message: any;
  action: 'accept' | 'reject' | 'next';
  response?: string;
}

export interface ConnectionInfo {
  connectionId: string;
  connectionIpAddr: string;
  clientAuthorized: boolean;
  clientPubkey: string;
}

export type Policy<Options = unknown> = (
  message: unknown[],
  connectionInfo: ConnectionInfo,
  options?: Options,
) => Promise<OutputMessage> | OutputMessage;
type PolicyTuple<P extends Policy = Policy> = [policy: P, options?: InferPolicyOptions<P>];
type InferPolicyOptions<P> = P extends Policy<infer Options> ? Options : never;
type Policies<T extends any[]> = {
  [K in keyof T]: PolicyTuple<T[K]> | Policy<T[K]>;
};

export const pfortnerInit = (
  upstreamAddress: string,
  options: {
    allowedAuthTimeDuration?: number;
    allowedAuthFutureTimeDuration?: number;
    maxAuthAttempts?: number;
    clientIp?: string;
    idleTimeout?: number;
    sendAuthOnConnect?: boolean;
    upstreamRawAddress?: string;
  } = {},
) => {
  let clientSocket: WebSocket | null = null;
  let serverSocket: WebSocketStream | null = null;
  let serverReadable: ReadableStream | null = null;
  let serverWritable: WritableStream | null = null;
  let serverWriter: WritableStreamDefaultWriter | null = null;

  let sessionTimer: number | null = null;

  let serverConnected = false;
  let clientConnected = false;
  let closeRequested = false;
  let clientDisconnectEmitted = false;
  let serverDisconnectEmitted = false;

  let clientPolicies: Policies<any[]> = [];
  let serverPolicies: Policies<any[]> = [];

  const connectionInfo: ConnectionInfo = {
    connectionId: crypto.randomUUID(),
    connectionIpAddr: options.clientIp || '127.0.0.1',
    clientAuthorized: false,
    clientPubkey: '',
  };

  const allowedAuthTimeDuration = Math.max(options.allowedAuthTimeDuration ?? 10 * 60, 1);
  const allowedAuthFutureTimeDuration = Math.max(options.allowedAuthFutureTimeDuration ?? 60, 1);
  const maxAuthAttempts = Math.max(options.maxAuthAttempts ?? 10, 1);
  const sendAuthOnConnect = options.sendAuthOnConnect ?? false;
  const idleTimeout = Math.max(options.idleTimeout ?? 10 * 60, 1) * 1000;

  let relayAddress: string | null = null;
  try {
    relayAddress = new URL(options.upstreamRawAddress || upstreamAddress).href;
  } catch {
    // Will be checked in verifyAuthMessage
  }

  const usedAuthEventIds = new Set<string>();
  let authAttemptCount = 0;

  const headers: HeadersInit = {};
  if (options.clientIp != null) {
    headers['X-Forwarded-For'] = options.clientIp;
  }
  const listeners = newListeners();

  if (sendAuthOnConnect) {
    on('clientConnect', sendAuthMessage);
  }
  on('clientAuth', verifyAuthMessage);

  function createSession(request: Request): Response {
    const opts = Deno.upgradeWebSocket(request);

    clientSocket = opts.socket;

    clientSocket.addEventListener('open', () => {
      if (closeRequested || clientDisconnectEmitted) {
        closeClientSocket();
        return;
      }

      clientConnected = true;

      setIdleTimeout();

      listeners.clientConnect.forEach((cb) => cb());
    });
    clientSocket.addEventListener('error', () => {
      listeners.clientError.forEach((cb) => cb());
    });
    clientSocket.addEventListener('message', async ({ data: json }) => {
      if (closeRequested || clientDisconnectEmitted) {
        return;
      }

      if (typeof json != 'string') {
        sendMessageToClient(JSON.stringify(['NOTICE', 'ERROR: bad msg: non-string message']));
        return;
      }

      let msg: unknown[];
      try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          sendMessageToClient(JSON.stringify(['NOTICE', 'ERROR: bad msg: expected JSON array']));
          return;
        }
        msg = parsed;
      } catch (e) {
        log.warn(`Failed to parse client message: ${e} connectionId=${connectionInfo.connectionId}`);
        sendMessageToClient(JSON.stringify(['NOTICE', 'ERROR: bad msg: unparsable JSON']));
        return;
      }

      setIdleTimeout();

      listeners.clientMsg.forEach((cb) => cb(json));

      switch (msg[0]) {
        case 'AUTH': // NIP-42
          if (msg.length >= 2) {
            const event = msg[1] as nostrTools.Event;
            listeners.clientAuth.forEach((cb) => cb(event));
          }
          return; // Terminate at proxy (Do not send message to upstream relay.)
        case 'CLOSE': // NIP-01
          if (msg.length >= 2) {
            const subscriptionId = msg[1] as string;
            listeners.clientClose.forEach((cb) => cb(subscriptionId));
          }
          break;
        case 'EVENT': // NIP-01
          if (msg.length >= 2) {
            const event = msg[1] as nostrTools.Event;
            listeners.clientEvent.forEach((cb) => cb(event));
          }
          break;
        case 'REQ': // NIP-01
          if (msg.length >= 3) {
            const subscriptionId = msg[1] as string;
            const filter = msg[2] as nostrTools.Filter;
            listeners.clientRequest.forEach((cb) => cb(subscriptionId, filter));
          }
          break;
      }

      try {
        await runPipeline(clientPolicies, msg, sendMessageToServer);
      } catch (e) {
        log.error(`Client policy error: ${e} connectionId=${connectionInfo.connectionId}`);
      }
    });
    clientSocket.addEventListener('close', () => {
      clientConnected = false;
      emitClientDisconnect();
      closeServerSocket();
      clearAllListeners();
    });

    const upstreamSocket = new WebSocketStream(upstreamAddress, { headers });
    serverSocket = upstreamSocket;

    upstreamSocket.opened.then((webSocketConnection) => {
      ({ readable: serverReadable, writable: serverWritable } = webSocketConnection);
      serverWriter = serverWritable.getWriter();

      if (closeRequested) {
        closeServerSocket();
        return;
      }

      serverConnected = true;
      setIdleTimeout();

      listeners.serverConnect.forEach((cb) => cb());

      (async () => {
        try {
          const readable = serverReadable;
          if (readable == null) return;
          for await (const json of readable) {
            setIdleTimeout();

            listeners.serverMsg.forEach((cb) => cb(json));

            let msg: unknown[];
            try {
              const parsed = JSON.parse(json);
              if (!Array.isArray(parsed) || parsed.length === 0) {
                continue;
              }
              msg = parsed;
            } catch (e) {
              log.warn(`Failed to parse server message: ${e}`);
              continue;
            }

            switch (msg[0]) {
              case 'EVENT': // NIP-01
                if (msg.length >= 3) {
                  const subscriptionId = msg[1] as string;
                  const event = msg[2] as nostrTools.Event;
                  listeners.serverEvent.forEach((cb) => cb(subscriptionId, event));
                }
                break;
              case 'OK': // NIP-01
                if (msg.length >= 3) {
                  const eventId = msg[1] as string;
                  const isPublished = msg[2] as boolean;
                  const message = (msg[3] as string) || '';
                  listeners.serverOk.forEach((cb) => cb(eventId, isPublished, message));
                }
                break;
              case 'EOSE': // NIP-01
                if (msg.length >= 2) {
                  const subscriptionId = msg[1] as string;
                  listeners.serverEose.forEach((cb) => cb(subscriptionId));
                }
                break;
              case 'CLOSED': // NIP-01
                if (msg.length >= 3) {
                  const subscriptionId = msg[1] as string;
                  const message = msg[2] as string;
                  listeners.serverClosed.forEach((cb) => cb(subscriptionId, message));
                }
                break;
              case 'NOTICE': // NIP-01
                if (msg.length >= 2) {
                  const message = msg[1] as string;
                  listeners.serverNotice.forEach((cb) => cb(message));
                }
                break;
            }

            try {
              await runPipeline(serverPolicies, msg, sendMessageToClient);
            } catch (e) {
              log.error(`Server policy error: ${e}`);
            }
          }
        } catch (e) {
          if (!closeRequested) {
            log.warn(`Server read loop error: ${e}`);
          }
        }
      })();
    }).catch(() => {
      if (!closeRequested) {
        listeners.serverError.forEach((cb) => cb());
        closeSocket(1011);
      }
    });

    upstreamSocket.closed.catch((e) => {
      if (!closeRequested) {
        log.warn(`Server socket closed with error: ${e}`);
      }
    }).finally(() => {
      const wasConnected = serverConnected;
      serverConnected = false;
      serverWriter = null;
      serverWritable = null;
      serverReadable = null;

      if (wasConnected) {
        emitServerDisconnect();
        if (!closeRequested) {
          closeClientSocket(1011);
          clearAllListeners();
        }
      }
    });

    return opts.response;
  }

  function on<T extends keyof SocketEvent, U extends SocketEvent[T]>(type: T, cb: U): void {
    listeners[type].push(cb);
  }
  function off<T extends keyof SocketEvent, U extends SocketEvent[T]>(type: T, cb: U): void {
    const index = listeners[type].indexOf(cb);
    if (index !== -1) listeners[type].splice(index, 1);
  }
  function clearAllListeners(): void {
    (Object.keys(listeners) as (keyof SocketEvent)[]).forEach((key) => {
      listeners[key] = [] as any;
    });
  }

  function emitClientDisconnect(): void {
    if (clientDisconnectEmitted) return;
    clientDisconnectEmitted = true;
    listeners.clientDisconnect.forEach((cb) => cb());
  }

  function emitServerDisconnect(): void {
    if (serverDisconnectEmitted) return;
    serverDisconnectEmitted = true;
    listeners.serverDisconnect.forEach((cb) => cb());
  }

  function sendAuthMessage(): void {
    sendMessageToClient(JSON.stringify(['AUTH', connectionInfo.connectionId]));
  }

  function currUnixtime(): number {
    return Math.floor(Date.now() / 1000);
  }

  function validateEventTime(event: nostrTools.Event): boolean {
    const now = currUnixtime();
    return (
      event.created_at > now - allowedAuthTimeDuration &&
      event.created_at < now + allowedAuthFutureTimeDuration
    );
  }

  function verifyAuthMessage(event: nostrTools.Event): void {
    // Rate limit: reject if too many AUTH attempts on this connection
    authAttemptCount++;
    if (authAttemptCount > maxAuthAttempts) {
      log.warn(`AUTH rate limit exceeded connectionId=${connectionInfo.connectionId}`);
      listeners.authFailed.forEach((cb) => cb());
      return;
    }

    // Replay prevention: reject if this AUTH event ID was already used
    if (usedAuthEventIds.has(event.id)) {
      log.warn(`AUTH replay detected eventId=${event.id} connectionId=${connectionInfo.connectionId}`);
      listeners.authFailed.forEach((cb) => cb());
      return;
    }

    if (relayAddress == null) {
      log.error('Invalid relay address for AUTH verification');
      listeners.authFailed.forEach((cb) => cb());
      return;
    }

    if (
      nostrTools.validateEvent(event) &&
      nostrTools.verifyEvent(event) &&
      event.kind === 22242 &&
      validateEventTime(event)
    ) {
      let checkChallenge = false;
      let checkRelay = false;

      for (const tag of event.tags) {
        if (
          tag.length === 2 &&
          tag[0] === 'challenge' &&
          tag[1] === connectionInfo.connectionId
        ) {
          checkChallenge = true;
        } else if (tag.length === 2 && tag[0] === 'relay') {
          try {
            if (new URL(tag[1]).href === relayAddress) {
              checkRelay = true;
            }
          } catch {
            // Invalid relay URL in tag
          }
        }
      }
      if (checkChallenge && checkRelay) {
        // Record used event ID to prevent replay
        usedAuthEventIds.add(event.id);
        connectionInfo.clientPubkey = event.pubkey;
        connectionInfo.clientAuthorized = true;
        listeners.authSuccess.forEach((cb) => cb(event));
      } else {
        listeners.authFailed.forEach((cb) => cb());
      }
    } else {
      listeners.authFailed.forEach((cb) => cb());
    }
  }

  async function sendMessageToClient(message: string): Promise<void> {
    const socket = clientSocket;
    if (socket == null || clientDisconnectEmitted) {
      return;
    }
    if (socket.readyState === socket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(), { once: true });
      });
    }
    if (socket.readyState === socket.OPEN && !clientDisconnectEmitted) {
      socket.send(message);
    } else {
      closeSocket();
    }
  }

  async function sendMessageToServer(message: string): Promise<void> {
    const upstreamSocket = serverSocket;
    if (upstreamSocket == null) {
      throw new Error('Server connection not initialized');
    }
    if (!serverConnected) {
      try {
        await Promise.race([
          upstreamSocket.opened,
          upstreamSocket.closed.then(() => {
            throw new Error('Server connection closed');
          }),
        ]);
      } catch {
        throw new Error('Server connection failed');
      }
    }
    if (closeRequested || !serverConnected || serverWriter == null) {
      throw new Error('Server connection closed');
    }
    await serverWriter.write(message);
  }

  function closeClientSocket(code = 1000): void {
    clearIdleTimeout();
    const socket = clientSocket;
    if (socket == null) return;

    const wasConnected = clientConnected ||
      socket.readyState === socket.CONNECTING ||
      socket.readyState === socket.OPEN ||
      socket.readyState === socket.CLOSING;

    if (socket.readyState === socket.CONNECTING || socket.readyState === socket.OPEN) {
      try {
        socket.close(code);
      } catch {
        // Socket may already be closing or closed
      }
    }
    clientConnected = false;
    if (wasConnected) {
      emitClientDisconnect();
    }
  }

  function closeServerSocket(): void {
    closeRequested = true;
    clearIdleTimeout();
    const wasConnected = serverConnected;

    if (serverWriter != null) {
      try {
        serverWriter.releaseLock();
      } catch {
        // Writer may already be released
      }
      serverWriter = null;
    }

    if (serverSocket != null) {
      try {
        serverSocket.close();
      } catch {
        // Socket may already be closing or closed
      }
    }

    serverConnected = false;
    if (wasConnected) {
      emitServerDisconnect();
    }
  }

  function closeSocket(code = 1000): void {
    closeRequested = true;
    closeClientSocket(code);
    closeServerSocket();
    clearAllListeners();
  }

  function setIdleTimeout(): void {
    clearIdleTimeout();
    sessionTimer = setTimeout(closeSocket, idleTimeout);
  }

  function clearIdleTimeout(): void {
    if (sessionTimer != null) {
      clearTimeout(sessionTimer);
      sessionTimer = null;
    }
  }

  function registerClientPipeline<T extends unknown[]>(policies: [...Policies<T>]): void {
    clientPolicies = policies;
  }

  function registerServerPipeline<T extends unknown[]>(policies: [...Policies<T>]): void {
    serverPolicies = policies;
  }

  function toTuple<P extends Policy>(item: PolicyTuple<P> | P): PolicyTuple<P> {
    return typeof item === 'function' ? [item] : item;
  }

  async function runPipeline(
    policies: Policies<any[]>,
    msg: unknown[],
    sendAccepted: (message: string) => Promise<void>,
  ): Promise<void> {
    for (const item of policies as (Policy | PolicyTuple)[]) {
      const [policy, options] = toTuple(item);
      const result = await policy(msg, connectionInfo, options);
      if (result.action === 'accept') {
        sendAccepted(JSON.stringify(result.message));
        break;
      } else if (result.action === 'reject') {
        if (result.response != null) {
          sendMessageToClient(result.response);
        }
        break;
      }
    }
  }

  return {
    closeSocket,
    createSession,
    registerClientPipeline,
    registerServerPipeline,
    sendAuthMessage,
    sendMessageToClient,
    sendMessageToServer,

    on,
    off,

    connectionInfo,
  };
};
