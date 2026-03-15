class ReservoirSampler {
  private samples: number[] = [];
  private count = 0;

  constructor(private maxSize: number = 10000) {}

  add(value: number): void {
    this.count++;
    if (this.samples.length < this.maxSize) {
      this.samples.push(value);
    } else {
      const idx = Math.floor(Math.random() * this.count);
      if (idx < this.maxSize) this.samples[idx] = value;
    }
  }

  percentile(p: number): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.max(0, Math.ceil((sorted.length * p) / 100) - 1);
    return sorted[idx];
  }

  getPercentiles(): { p50: number | null; p95: number | null; p99: number | null } {
    return { p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99) };
  }
}

export interface ScenarioStats {
  connections: {
    established: number;
    failed: number;
    max_concurrent: number;
    latency_ms: { p50: number | null; p95: number | null; p99: number | null };
  };
  events: {
    sent: number;
    ok: number;
    rejected: number;
    latency_ms: { p50: number | null; p95: number | null; p99: number | null };
  };
  requests: {
    sent: number;
    eose: number;
    latency_ms: { p50: number | null; p95: number | null; p99: number | null };
  };
  auth: {
    challenges: number;
    responses: number;
    latency_ms: { p50: number | null; p95: number | null; p99: number | null };
  };
  errors: { ws_errors: number; timeouts: number; backpressure_skips: number };
  // Aliases for display
  event_latency: { p50: number | null; p95: number | null; p99: number | null };
}

export class MetricsCollector {
  private connLatency: ReservoirSampler;
  private eventLatency: ReservoirSampler;
  private reqLatency: ReservoirSampler;
  private authLatencySampler: ReservoirSampler;

  private connEstablished = 0;
  private connFailed = 0;
  private maxConcurrent = 0;
  private eventsSent = 0;
  private eventsOk = 0;
  private eventsRejected = 0;
  private reqsSent = 0;
  private reqsEose = 0;
  private authChallenges = 0;
  private authResponses = 0;
  private wsErrors = 0;
  private timeouts = 0;
  private backpressureSkips = 0;

  constructor(reservoirSize = 10000) {
    this.connLatency = new ReservoirSampler(reservoirSize);
    this.eventLatency = new ReservoirSampler(reservoirSize);
    this.reqLatency = new ReservoirSampler(reservoirSize);
    this.authLatencySampler = new ReservoirSampler(reservoirSize);
  }

  recordConnectionEstablished(): void {
    this.connEstablished++;
  }
  recordConnectionFailed(): void {
    this.connFailed++;
  }
  recordConnectionLatency(ms: number): void {
    this.connLatency.add(ms);
  }
  updateMaxConcurrent(n: number): void {
    if (n > this.maxConcurrent) this.maxConcurrent = n;
  }

  recordEvent(type: 'sent' | 'ok' | 'rejected'): void {
    if (type === 'sent') this.eventsSent++;
    else if (type === 'ok') this.eventsOk++;
    else this.eventsRejected++;
  }
  recordEventLatency(ms: number): void {
    this.eventLatency.add(ms);
  }

  recordRequest(type: 'sent' | 'eose'): void {
    if (type === 'sent') this.reqsSent++;
    else this.reqsEose++;
  }
  recordRequestLatency(ms: number): void {
    this.reqLatency.add(ms);
  }

  recordAuthChallenge(): void {
    this.authChallenges++;
  }
  recordAuthResponse(): void {
    this.authResponses++;
  }
  recordAuthLatency(ms: number): void {
    this.authLatencySampler.add(ms);
  }

  recordError(type: 'ws_error' | 'timeout' | 'backpressure'): void {
    if (type === 'ws_error') this.wsErrors++;
    else if (type === 'timeout') this.timeouts++;
    else this.backpressureSkips++;
  }

  getStats(): ScenarioStats {
    const elat = this.eventLatency.getPercentiles();
    return {
      connections: {
        established: this.connEstablished,
        failed: this.connFailed,
        max_concurrent: this.maxConcurrent,
        latency_ms: this.connLatency.getPercentiles(),
      },
      events: { sent: this.eventsSent, ok: this.eventsOk, rejected: this.eventsRejected, latency_ms: elat },
      requests: { sent: this.reqsSent, eose: this.reqsEose, latency_ms: this.reqLatency.getPercentiles() },
      auth: {
        challenges: this.authChallenges,
        responses: this.authResponses,
        latency_ms: this.authLatencySampler.getPercentiles(),
      },
      errors: { ws_errors: this.wsErrors, timeouts: this.timeouts, backpressure_skips: this.backpressureSkips },
      event_latency: elat,
    };
  }
}
