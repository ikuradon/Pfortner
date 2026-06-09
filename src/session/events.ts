import { log, nostrTools } from '../deps.ts';

export type SocketEvent = {
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

export type SocketEventListeners = { [TK in keyof SocketEvent]: SocketEvent[TK][] };

export const newListeners = (): SocketEventListeners => ({
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

export function createSocketEventBus(getConnectionId: () => string) {
  const listeners = newListeners();

  function on<T extends keyof SocketEvent, U extends SocketEvent[T]>(type: T, cb: U): void {
    listeners[type].push(cb);
  }

  function off<T extends keyof SocketEvent, U extends SocketEvent[T]>(type: T, cb: U): void {
    const index = listeners[type].indexOf(cb);
    if (index !== -1) listeners[type].splice(index, 1);
  }

  function clear(): void {
    (Object.keys(listeners) as (keyof SocketEvent)[]).forEach((key) => {
      listeners[key] = [] as any;
    });
  }

  async function emit<T extends keyof SocketEvent>(
    type: T,
    ...args: Parameters<SocketEvent[T]>
  ): Promise<void> {
    const callbacks = listeners[type] as Array<(...args: Parameters<SocketEvent[T]>) => void | Promise<void>>;
    for (const cb of callbacks) {
      try {
        await cb(...args);
      } catch (e) {
        log.error(`Listener error: ${e} type=${type} connectionId=${getConnectionId()}`);
      }
    }
  }

  return {
    listeners,
    on,
    off,
    clear,
    emit,
  };
}
