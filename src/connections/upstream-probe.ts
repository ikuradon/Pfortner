// src/connections/upstream-probe.ts
type IntervalHandle = ReturnType<typeof setInterval>;

export class UpstreamProbe {
  private latency: number | null = null;
  private status: 'connected' | 'disconnected' | 'unknown' = 'unknown';
  private interval: IntervalHandle | null = null;

  constructor(
    private httpUrl: string,
    private intervalMs: number = 60000,
  ) {}

  static fromRelayUrl(relayUrl: string, rawUrl?: string, intervalMs = 60000): UpstreamProbe | null {
    const url = rawUrl ?? relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    try {
      new URL(url); // validate
      return new UpstreamProbe(url, intervalMs);
    } catch {
      return null;
    }
  }

  start(): void {
    this.probe(); // initial probe
    this.interval = setInterval(() => this.probe(), this.intervalMs);
  }

  stop(): void {
    if (this.interval != null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getLatency(): number | null {
    return this.latency;
  }

  getStatus(): 'connected' | 'disconnected' | 'unknown' {
    return this.status;
  }

  private async probe(): Promise<void> {
    const start = Date.now();
    try {
      const response = await fetch(this.httpUrl, {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        this.latency = Date.now() - start;
        this.status = 'connected';
      } else {
        this.status = 'disconnected';
        this.latency = null;
      }
      // Consume body to free resources
      await response.text().catch(() => {});
    } catch {
      this.status = 'disconnected';
      this.latency = null;
    }
  }
}
