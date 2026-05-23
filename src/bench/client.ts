import type { MetricsCollector } from './metrics.ts';

type TimerHandle = ReturnType<typeof setTimeout>;

export class BenchClient {
  private ws: WebSocket | null = null;
  private pendingOk = new Map<string, { resolve: () => void; timer: TimerHandle; startTime: number }>();
  private pendingEose = new Map<string, { resolve: () => void; timer: TimerHandle; startTime: number }>();
  private authHandler: ((challenge: string) => void) | null = null;
  private _connected = false;

  constructor(
    private url: string,
    private metrics: MetricsCollector,
    private timeoutMs = 10000,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  static generateEvent(kind: number, contentLength: number): Record<string, unknown> {
    const content = Array.from(
      { length: contentLength },
      () => String.fromCharCode(97 + Math.floor(Math.random() * 26)),
    ).join('');
    return {
      id: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      pubkey: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
      sig: crypto.randomUUID().replace(/-/g, '') +
        crypto.randomUUID().replace(/-/g, '') +
        crypto.randomUUID().replace(/-/g, '') +
        crypto.randomUUID().replace(/-/g, ''),
    };
  }

  static generateSubId(): string {
    return `bench-${crypto.randomUUID().slice(0, 8)}`;
  }

  connect(): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        this.metrics.recordConnectionFailed();
        reject(e);
        return;
      }

      const timer = setTimeout(() => {
        this.metrics.recordConnectionFailed();
        this.metrics.recordError('timeout');
        reject(new Error('connect timeout'));
      }, this.timeoutMs);

      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        this._connected = true;
        this.metrics.recordConnectionEstablished();
        this.metrics.recordConnectionLatency(Date.now() - start);
        resolve();
      });

      this.ws.addEventListener('error', () => {
        clearTimeout(timer);
        this._connected = false;
        this.metrics.recordConnectionFailed();
        this.metrics.recordError('ws_error');
        reject(new Error('ws error'));
      });

      this.ws.addEventListener('close', () => {
        this._connected = false;
      });

      this.ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!Array.isArray(msg)) return;
          this.handleMessage(msg);
        } catch { /* ignore parse errors */ }
      });
    });
  }

  private handleMessage(msg: unknown[]): void {
    switch (msg[0]) {
      case 'OK': {
        const eventId = msg[1] as string;
        const success = msg[2] as boolean;
        this.metrics.recordEvent(success ? 'ok' : 'rejected');
        const pending = this.pendingOk.get(eventId);
        if (pending) {
          clearTimeout(pending.timer);
          this.metrics.recordEventLatency(Date.now() - pending.startTime);
          this.pendingOk.delete(eventId);
          pending.resolve();
        }
        break;
      }
      case 'EOSE': {
        const subId = msg[1] as string;
        this.metrics.recordRequest('eose');
        const pending = this.pendingEose.get(subId);
        if (pending) {
          clearTimeout(pending.timer);
          this.metrics.recordRequestLatency(Date.now() - pending.startTime);
          this.pendingEose.delete(subId);
          pending.resolve();
        }
        break;
      }
      case 'AUTH': {
        const challenge = msg[1] as string;
        this.metrics.recordAuthChallenge();
        if (this.authHandler) this.authHandler(challenge);
        break;
      }
    }
  }

  onAuth(handler: (challenge: string) => void): void {
    this.authHandler = handler;
  }

  async sendEvent(kind: number, contentLength: number): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const event = BenchClient.generateEvent(kind, contentLength);
    const eventId = event.id as string;
    this.metrics.recordEvent('sent');
    const startTime = Date.now();

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingOk.delete(eventId);
        this.metrics.recordError('timeout');
        resolve();
      }, this.timeoutMs);
      this.pendingOk.set(eventId, { resolve, timer, startTime });
      this.ws!.send(JSON.stringify(['EVENT', event]));
    });
    // Latency is recorded in handleMessage when OK is received (not on timeout)
  }

  async sendReq(filters: Record<string, unknown>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const subId = BenchClient.generateSubId();
    this.metrics.recordRequest('sent');
    const startTime = Date.now();

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingEose.delete(subId);
        this.metrics.recordError('timeout');
        resolve();
      }, this.timeoutMs);
      this.pendingEose.set(subId, { resolve, timer, startTime });
      this.ws!.send(JSON.stringify(['REQ', subId, filters]));
    });
    // Latency and EOSE count recorded in handleMessage when EOSE is received

    // Clean up subscription
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['CLOSE', subId]));
    }
  }

  close(): void {
    if (this.ws) {
      // Clear all pending
      for (const [, pending] of this.pendingOk) clearTimeout(pending.timer);
      for (const [, pending] of this.pendingEose) clearTimeout(pending.timer);
      this.pendingOk.clear();
      this.pendingEose.clear();

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000);
      }
      this._connected = false;
    }
  }
}
