// src/upstream/pool.ts
import type { Logger } from '../plugins/types.ts';

export class UpstreamConnection {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, {
    onEvent: (subId: string, event: unknown) => void;
    onEose: (subId: string) => void;
    onClosed?: (subId: string, message: string) => void;
    filters: unknown[];
  }>();
  private pendingOk = new Map<
    string,
    { onOk: (eventId: string, success: boolean, message: string) => void; timer: number }
  >();
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private _connected = false;

  constructor(private url: string, private logger: Logger) {}

  static prefixSubId(clientId: string, subId: string): string {
    return `${clientId}:${subId}`;
  }

  static parsePrefixedSubId(prefixed: string): { clientId: string; subId: string } | null {
    const idx = prefixed.indexOf(':');
    if (idx === -1) return null;
    return { clientId: prefixed.slice(0, idx), subId: prefixed.slice(idx + 1) };
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }

      const timeout = setTimeout(() => reject(new Error('connect timeout')), 10000);

      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        this._connected = true;
        this.reconnectDelay = 1000;
        this.logger.info('Connected to upstream relay', { url: this.url });
        resolve();
      });

      this.ws.addEventListener('error', () => {
        clearTimeout(timeout);
        this._connected = false;
        reject(new Error(`WebSocket error: ${this.url}`));
      });

      this.ws.addEventListener('close', () => {
        this._connected = false;
        this.scheduleReconnect();
      });

      this.ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (Array.isArray(msg)) this.handleMessage(msg);
        } catch { /* ignore */ }
      });
    });
  }

  private handleMessage(msg: unknown[]): void {
    switch (msg[0]) {
      case 'EVENT': {
        const prefixedSubId = msg[1] as string;
        const event = msg[2];
        const parsed = UpstreamConnection.parsePrefixedSubId(prefixedSubId);
        if (parsed) {
          const sub = this.subscriptions.get(UpstreamConnection.prefixSubId(parsed.clientId, parsed.subId));
          sub?.onEvent(parsed.subId, event);
        }
        break;
      }
      case 'EOSE': {
        const prefixedSubId = msg[1] as string;
        const parsed = UpstreamConnection.parsePrefixedSubId(prefixedSubId);
        if (parsed) {
          const sub = this.subscriptions.get(UpstreamConnection.prefixSubId(parsed.clientId, parsed.subId));
          sub?.onEose(parsed.subId);
        }
        break;
      }
      case 'CLOSED': {
        const prefixedSubId = msg[1] as string;
        const message = (msg[2] as string) ?? '';
        const parsed = UpstreamConnection.parsePrefixedSubId(prefixedSubId);
        if (parsed) {
          const key = UpstreamConnection.prefixSubId(parsed.clientId, parsed.subId);
          const sub = this.subscriptions.get(key);
          sub?.onClosed?.(parsed.subId, message);
          this.subscriptions.delete(key);
        }
        break;
      }
      case 'OK': {
        const eventId = msg[1] as string;
        const success = msg[2] as boolean;
        const message = (msg[3] as string) ?? '';
        const pending = this.pendingOk.get(eventId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingOk.delete(eventId);
          pending.onOk(eventId, success, message);
        }
        break;
      }
      case 'NOTICE': {
        this.logger.warn('NOTICE from routed relay', { url: this.url, message: msg[1] });
        break;
      }
    }
  }

  subscribe(
    clientId: string,
    subId: string,
    filters: unknown[],
    onEvent: (subId: string, event: unknown) => void,
    onEose: (subId: string) => void,
    onClosed?: (subId: string, message: string) => void,
  ): void {
    const prefixed = UpstreamConnection.prefixSubId(clientId, subId);
    this.subscriptions.set(prefixed, { onEvent, onEose, onClosed, filters });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['REQ', prefixed, ...filters]));
    }
  }

  unsubscribe(clientId: string, subId: string): void {
    const prefixed = UpstreamConnection.prefixSubId(clientId, subId);
    this.subscriptions.delete(prefixed);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['CLOSE', prefixed]));
    }
  }

  unsubscribeAll(clientId: string): void {
    const prefix = clientId + ':';
    for (const key of [...this.subscriptions.keys()]) {
      if (key.startsWith(prefix)) {
        this.subscriptions.delete(key);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(['CLOSE', key]));
        }
      }
    }
  }

  sendEvent(
    _clientId: string,
    event: unknown,
    onOk: (eventId: string, success: boolean, message: string) => void,
  ): void {
    const eventId = (event as any)?.id as string;
    if (eventId && this.ws?.readyState === WebSocket.OPEN) {
      const timer = setTimeout(() => {
        this.pendingOk.delete(eventId);
      }, 10000);
      this.pendingOk.set(eventId, { onOk, timer });
      this.ws.send(JSON.stringify(['EVENT', event]));
    }
  }

  close(): void {
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
    for (const [, pending] of this.pendingOk) clearTimeout(pending.timer);
    this.pendingOk.clear();
    this.subscriptions.clear();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close(1000);
    }
    this._connected = false;
  }

  private scheduleReconnect(): void {
    if (this.subscriptions.size === 0) return; // no active subscriptions, don't reconnect
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        // Re-subscribe all active subscriptions
        for (const [prefixed, sub] of this.subscriptions) {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(['REQ', prefixed, ...sub.filters]));
          }
        }
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }
}

export class UpstreamPool {
  private connections = new Map<string, UpstreamConnection>();

  constructor(private logger: Logger) {}

  async getConnection(url: string): Promise<UpstreamConnection> {
    let conn = this.connections.get(url);
    if (conn && conn.connected) return conn;
    if (conn) conn.close(); // clean up dead connection

    conn = new UpstreamConnection(url, this.logger);
    await conn.connect();
    this.connections.set(url, conn);
    return conn;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  notifyClientDisconnect(clientId: string): void {
    for (const conn of this.connections.values()) {
      conn.unsubscribeAll(clientId);
    }
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
  }
}
