import { log, nostrTools } from './deps.ts';
import { createAuthVerifier, resolveAuthRelayAddress } from './session/auth.ts';
import { parseClientMessagePayload } from './session/client-session.ts';
import { createSocketEventBus } from './session/events.ts';
import { type Policies, runPolicyPipeline } from './session/pipeline-runner.ts';
import { closeUpstreamSocket, createUpstreamHeaders } from './session/upstream.ts';

const POLICY_VIOLATION_CLOSE_CODE = 1008;

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
    pubkeyBlocklist?: Set<string>;
  } = {},
) => {
  let clientSocket: WebSocket | null = null;
  let serverSocket: WebSocketStream | null = null;
  let serverReadable: ReadableStream | null = null;
  let serverWritable: WritableStream | null = null;
  let serverWriter: WritableStreamDefaultWriter | null = null;

  let sessionTimer: ReturnType<typeof setTimeout> | null = null;

  let serverConnected = false;
  let closeRequested = false;
  let clientDisconnectEmitted = false;
  let serverDisconnectEmitted = false;

  let clientPolicies: Policies<any[]> = [];
  let serverPolicies: Policies<any[]> = [];

  const connectionInfo: ConnectionInfo = {
    connectionId: crypto.randomUUID(),
    connectionIpAddr: options.clientIp ?? '',
    clientAuthorized: false,
    clientPubkey: '',
  };
  let sessionStarted = false;

  const allowedAuthTimeDuration = Math.max(options.allowedAuthTimeDuration ?? 10 * 60, 1);
  const allowedAuthFutureTimeDuration = Math.max(options.allowedAuthFutureTimeDuration ?? 60, 1);
  const maxAuthAttempts = Math.max(options.maxAuthAttempts ?? 10, 1);
  const sendAuthOnConnect = options.sendAuthOnConnect ?? false;
  const idleTimeout = Math.max(options.idleTimeout ?? 10 * 60, 1) * 1000;

  function isBlockedPubkey(pubkey: unknown): boolean {
    return typeof pubkey === 'string' && options.pubkeyBlocklist?.has(pubkey) === true;
  }

  function isBlockedClientMessage(msg: unknown[]): boolean {
    if (isBlockedPubkey(connectionInfo.clientPubkey)) {
      return true;
    }
    if (msg[0] === 'EVENT') {
      const event = msg[1] as { pubkey?: unknown } | undefined;
      return isBlockedPubkey(event?.pubkey);
    }
    return false;
  }

  function closeBlockedConnection(): void {
    closeSocket(POLICY_VIOLATION_CLOSE_CODE);
  }

  const headers = createUpstreamHeaders(options.clientIp);
  const eventBus = createSocketEventBus(() => connectionInfo.connectionId);
  const { listeners, on, off, emit } = eventBus;
  const verifyAuthMessage = createAuthVerifier({
    connectionInfo,
    relayAddress: resolveAuthRelayAddress(upstreamAddress, options.upstreamRawAddress),
    allowedAuthTimeDuration,
    allowedAuthFutureTimeDuration,
    maxAuthAttempts,
    isBlockedPubkey,
    onAuthSuccess: (event) => listeners.authSuccess.forEach((cb) => cb(event)),
    onAuthFailed: () => listeners.authFailed.forEach((cb) => cb()),
    onBlocked: closeBlockedConnection,
  });

  if (sendAuthOnConnect) {
    on('clientConnect', sendAuthMessage);
  }
  on('clientAuth', verifyAuthMessage);

  function createSession(request: Request): Response {
    if (sessionStarted) {
      return new Response('WebSocket session already started for this proxy instance', { status: 409 });
    }

    const opts = Deno.upgradeWebSocket(request);
    sessionStarted = true;

    clientSocket = opts.socket;

    clientSocket.addEventListener('open', () => {
      if (closeRequested || clientDisconnectEmitted) {
        closeClientSocket();
        return;
      }

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

      const parsedMessage = parseClientMessagePayload(json);
      if (!parsedMessage.ok) {
        if (parsedMessage.warning) {
          log.warn(`${parsedMessage.warning} connectionId=${connectionInfo.connectionId}`);
        }
        sendMessageToClient(JSON.stringify(['NOTICE', parsedMessage.notice]));
        return;
      }
      const msg = parsedMessage.message;

      setIdleTimeout();

      try {
        if (isBlockedClientMessage(msg)) {
          await sendMessageToClient(JSON.stringify(['NOTICE', 'ERROR: blocked: pubkey blocked']));
          closeBlockedConnection();
          return;
        }

        await emit('clientMsg', json);

        switch (msg[0]) {
          case 'AUTH': // NIP-42
            if (msg.length >= 2) {
              const event = msg[1] as nostrTools.Event;
              await emit('clientAuth', event);
            }
            return; // proxy で終端し、upstream relay には送らない。
          case 'CLOSE': // NIP-01
            if (msg.length >= 2) {
              const subscriptionId = msg[1] as string;
              await emit('clientClose', subscriptionId);
            }
            break;
          case 'EVENT': // NIP-01
            if (msg.length !== 2) {
              sendMessageToClient(JSON.stringify(['NOTICE', 'ERROR: bad msg: invalid EVENT message']));
              return;
            }
            {
              const event = msg[1] as nostrTools.Event;
              await emit('clientEvent', event);
            }
            break;
          case 'REQ': // NIP-01
            if (msg.length >= 3) {
              const subscriptionId = msg[1] as string;
              const filter = msg[2] as nostrTools.Filter;
              await emit('clientRequest', subscriptionId, filter);
            }
            break;
        }

        await runPolicyPipeline(clientPolicies, msg, connectionInfo, {
          sendAccepted: sendMessageToServer,
          sendRejected: sendMessageToClient,
        });
      } catch (e) {
        log.error(`Client message handling error: ${e} connectionId=${connectionInfo.connectionId}`);
      }
    });
    clientSocket.addEventListener('close', () => {
      emitClientDisconnect();
      closeServerSocket();
      clearAllListeners();
    });

    const upstreamSocket = new WebSocketStream(upstreamAddress, { headers });
    serverSocket = upstreamSocket;

    upstreamSocket.opened.then((webSocketConnection) => {
      if (closeRequested) {
        closeUpstreamSocket(upstreamSocket);
        return;
      }

      ({ readable: serverReadable, writable: serverWritable } = webSocketConnection);
      serverWriter = serverWritable.getWriter();

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

            if (isBlockedPubkey(connectionInfo.clientPubkey)) {
              closeBlockedConnection();
              return;
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
              await relayServerMessageToClient(msg);
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
      if (serverSocket === upstreamSocket) {
        serverSocket = null;
      }
      serverConnected = false;
      serverWriter = null;
      serverWritable = null;
      serverReadable = null;

      if (wasConnected) {
        emitServerDisconnect();
        if (!closeRequested) {
          closeRequested = true;
          closeClientSocket(1011);
          clearAllListeners();
        }
      }
    });

    return opts.response;
  }

  function clearAllListeners(): void {
    eventBus.clear();
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

    if (socket.readyState === socket.CONNECTING || socket.readyState === socket.OPEN) {
      try {
        socket.close(code);
      } catch {
        // socket が既に closing/closed の場合は何もしない。
      }
    }
    emitClientDisconnect();
  }

  function closeServerSocket(): void {
    closeRequested = true;
    clearIdleTimeout();
    const wasConnected = serverConnected;
    const socket = serverSocket;
    serverSocket = null;

    if (serverWriter != null) {
      try {
        serverWriter.releaseLock();
      } catch {
        // writer が既に release 済みの場合は何もしない。
      }
      serverWriter = null;
    }
    serverWritable = null;
    serverReadable = null;

    if (socket != null) {
      closeUpstreamSocket(socket);
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

  async function relayServerMessageToClient(message: unknown[]): Promise<void> {
    if (isBlockedPubkey(connectionInfo.clientPubkey)) {
      closeBlockedConnection();
      return;
    }
    await runPolicyPipeline(serverPolicies, message, connectionInfo, {
      sendAccepted: sendMessageToClient,
      sendRejected: sendMessageToClient,
    });
  }

  return {
    closeSocket,
    createSession,
    registerClientPipeline,
    registerServerPipeline,
    sendAuthMessage,
    sendMessageToClient,
    sendMessageToServer,
    relayServerMessageToClient,

    on,
    off,

    connectionInfo,
  };
};
