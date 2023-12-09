import { nostrTools } from './deps.ts';

type SocketEvent = {
  authSuccess: () => void | Promise<void>;
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
  serverNotice: [],
});

interface OutputMessage {
  message: any;
  action: 'accept' | 'reject' | 'next';
}

interface ConnectionInfo {
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
    clientIp?: string;
    idleTimeout?: number;
    sendAuthOnConnect?: boolean;
    upstreamRawAddress?: string;
  } = {},
) => {
  let clientSocket: WebSocket;
  let serverSocket: WebSocketStream;
  let serverReadable: ReadableStream;
  let serverWritable: WritableStream;
  let serverWriter: WritableStreamDefaultWriter;

  let sessionTimer: number | null = null;

  let serverConnected = false;
  let clientConnected = false;

  let clientPolicies: Policies<any[]>;
  let serverPolicies: Policies<any[]>;

  const connectionInfo: ConnectionInfo = {
    connectionId: crypto.randomUUID(),
    connectionIpAddr: options.clientIp || '127.0.0.1',
    clientAuthorized: false,
    clientPubkey: '',
  };

  const allowedAuthTimeDuration = options.allowedAuthTimeDuration || 10 * 60;
  const sendAuthOnConnect = options.sendAuthOnConnect || false;
  const idleTimeout = (options.idleTimeout || 10 * 60) * 1000;

  const headers: HeadersInit = {};
  if (options.clientIp != null) {
    headers['X-Forwarded-For'] = options.clientIp;
  }
  const listeners = newListeners();

  if (sendAuthOnConnect) {
    on('clientConnect', sendAuthMessage);
  }
  on('clientAuth', verifyAuthMessage);

  async function createSession(request: Request): Promise<Response> {
    const opts = Deno.upgradeWebSocket(request);

    clientSocket = opts.socket;

    clientSocket.addEventListener('open', () => {
      clientConnected = true;

      setIdleTimeout();

      listeners.clientConnect.forEach((cb) => cb());
    });
    clientSocket.addEventListener('error', () => {
      listeners.clientError.forEach((cb) => cb());
    });
    clientSocket.addEventListener('message', async ({ data: json }) => {
      setIdleTimeout();

      listeners.clientMsg.forEach((cb) => cb(json));

      try {
        const msg = JSON.parse(json);
        switch (msg[0]) {
          case 'AUTH': // NIP-42
            {
              const event: nostrTools.Event = msg[1];
              listeners.clientAuth.forEach((cb) => cb(event));
            }
            return; // Terminate at proxy (Do not send message to upstream relay.)
          case 'CLOSE': // NIP-01
            {
              const subId: string = msg[1];
              listeners.clientClose.forEach((cb) => cb(subId));
            }
            break;
          case 'EVENT': // NIP-01
            {
              const event: nostrTools.Event = msg[1];
              listeners.clientEvent.forEach((cb) => cb(event));
            }
            break;
          case 'REQ': // NIP-01
            {
              const subId: string = msg[1];
              const filter: nostrTools.Filter = msg[2];
              listeners.clientRequest.forEach((cb) => cb(subId, filter));
            }
            break;
        }

        for (const item of clientPolicies as (Policy | PolicyTuple)[]) {
          const [policy, options] = toTuple(item);
          const result = await policy(msg, connectionInfo, options);
          if (result.action === 'accept') {
            sendmessageToServer(JSON.stringify(result.message));
            break;
          } else if (result.action === 'reject') {
            break;
          }
        }
      } catch (e) {
        console.log(e);
      }
    });
    clientSocket.addEventListener('close', () => {
      clientConnected = false;
      listeners.clientDisconnect.forEach((cb) => cb());
      closeServerSocket();
    });

    serverSocket = new WebSocketStream(upstreamAddress, { headers });

    await serverSocket.opened.then((webSocketConnection) => {
      ({ readable: serverReadable, writable: serverWritable } = webSocketConnection);
      serverWriter = serverWritable.getWriter();

      serverConnected = true;
      setIdleTimeout();

      listeners.serverConnect.forEach((cb) => cb());
    }).catch(() => {
      listeners.serverError.forEach((cb) => cb());
    });

    (async () => {
      for await (const json of serverReadable) {
        setIdleTimeout();

        listeners.serverMsg.forEach((cb) => cb(json));

        try {
          const msg = JSON.parse(json);
          switch (msg[0]) {
            case 'EVENT': // NIP-01
              {
                const subId = msg[1];
                const event: nostrTools.Event = msg[2];
                listeners.serverEvent.forEach((cb) => cb(subId, event));
              }
              break;
            case 'OK': // NIP-01
              {
                const eventId = msg[1];
                const isPublished = msg[2];
                const message = msg[3] || '';
                listeners.serverOk.forEach((cb) => cb(eventId, isPublished, message));
              }
              break;
            case 'EOSE': // NIP-01
              {
                const subId: string = msg[1];
                listeners.serverEose.forEach((cb) => cb(subId));
              }
              break;
            case 'NOTICE': // NIP-01
            {
              const message: string = msg[1];
              listeners.serverNotice.forEach((cb) => cb(message));
            }
          }

          for (const item of serverPolicies as (Policy | PolicyTuple)[]) {
            const [policy, options] = toTuple(item);
            const result = await policy(msg, connectionInfo, options);
            if (result.action === 'accept') {
              sendmessageToClient(JSON.stringify(result.message));
              break;
            } else if (result.action === 'reject') {
              break;
            }
          }
        } catch (e) {
          console.log(e);
        }
      }
    })();

    (async () => {
      await serverSocket.closed.then(() => {
        listeners.serverDisconnect.forEach((cb) => cb());
        closeClientSocket();
      });
    })();

    return opts.response;
  }

  function on<T extends keyof SocketEvent, U extends SocketEvent[T]>(type: T, cb: U): void {
    listeners[type].push(cb);
  }
  function off<T extends keyof SocketEvent, U extends SocketEvent[T]>(type: T, cb: U): void {
    const index = listeners[type].indexOf(cb);
    if (index !== -1) listeners[type].splice(index, 1);
  }

  function sendAuthMessage(): void {
    const msg = ['AUTH'];
    msg.push(connectionInfo.connectionId);

    sendmessageToClient(JSON.stringify(msg));
  }

  function currUnixtime(): number {
    return Math.floor(new Date().getTime() / 1000);
  }

  function validateEventTime(event: nostrTools.Event): boolean {
    const now = currUnixtime();
    if (
      event.created_at > now - allowedAuthTimeDuration &&
      event.created_at < now + allowedAuthTimeDuration
    ) {
      return true;
    }
    return false;
  }

  function verifyAuthMessage(event: nostrTools.Event): void {
    let checkChallenge = false;
    let checkRelay = false;

    const relayAddress = new URL(options.upstreamRawAddress || upstreamAddress).href;

    if (
      nostrTools.validateEvent(event) &&
      nostrTools.verifySignature(event) &&
      event.kind === 22242 &&
      validateEventTime(event)
    ) {
      event.tags.forEach((tag) => {
        if (
          tag.length === 2 &&
          tag[0] === 'challenge' &&
          tag[1] === connectionInfo.connectionId
        ) {
          checkChallenge = true;
        } else if (
          tag.length === 2 &&
          tag[0] === 'relay' &&
          new URL(tag[1]).href === relayAddress
        ) {
          checkRelay = true;
        }
      });
      if (checkChallenge && checkRelay) {
        connectionInfo.clientPubkey = event.pubkey;
        connectionInfo.clientAuthorized = true;
        listeners.authSuccess.forEach((cb) => cb());
      } else {
        listeners.authFailed.forEach((cb) => cb());
      }
    }
  }

  async function sendmessageToClient(message: string): Promise<void> {
    switch (clientSocket.readyState) {
      case clientSocket.CONNECTING: {
        await new Promise<void>((resolve, reject) => {
          clientSocket.addEventListener('open', () => resolve());
          clientSocket.addEventListener('error', () => reject());
        });
      }
      // falls through
      case clientSocket.OPEN:
        {
          clientSocket.send(message);
        }
        break;
      case clientSocket.CLOSING:
      case clientSocket.CLOSED:
        {
          closeSocket();
        }
        break;
    }
  }

  async function sendmessageToServer(message: string): Promise<void> {
    if (!serverConnected) {
      await new Promise<void>((resolve, reject) => {
        on('serverConnect', () => resolve());
        on('serverError', () => reject());
      });
    }
    await serverWriter.write(message);
  }

  function closeClientSocket(code = 1000): void {
    if (clientConnected) {
      clearIdleTimeout();
      clientSocket.close(code);
      clientConnected = false;
    }
  }

  function closeServerSocket(): void {
    if (serverConnected) {
      clearIdleTimeout();
      serverSocket.close();
      serverConnected = false;
    }
  }

  function closeSocket(code = 1000): void {
    closeClientSocket(code);
    closeServerSocket();
  }

  function setIdleTimeout(): void {
    clearIdleTimeout();
    sessionTimer = setTimeout(closeSocket, idleTimeout);
  }

  function clearIdleTimeout(): void {
    if (sessionTimer != null) {
      clearTimeout(sessionTimer);
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

  return {
    closeSocket,
    createSession,
    registerClientPipeline,
    registerServerPipeline,
    sendAuthMessage,
    sendmessageToClient,
    sendmessageToServer,

    on,
    off,

    connectionInfo,
  };
};
