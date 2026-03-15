// src/bench/runner.ts
import { BenchClient } from './client.ts';
import { MetricsCollector } from './metrics.ts';
import { ProgressDisplay } from './display.ts';
import type { BenchConfig, BenchScenario } from './scenario.ts';

export class ScenarioRunner {
  private clients: BenchClient[] = [];
  private display = new ProgressDisplay();

  constructor(private config: BenchConfig) {}

  async execute(scenario: BenchScenario): Promise<MetricsCollector> {
    const metrics = new MetricsCollector();

    // Reset connections if requested
    if (scenario.connections.reset) {
      for (const client of this.clients) client.close();
      this.clients = [];
    }

    const targetConns = scenario.connections.target;
    const currentConns = this.clients.length;
    const duration = scenario.duration * 1000;
    const start = Date.now();

    // Connection ramp/adjust
    if (targetConns > currentConns) {
      const toAdd = targetConns - currentConns;
      const interval = scenario.connections.ramp ? duration / toAdd : 0;

      for (let i = 0; i < toAdd; i++) {
        if (scenario.connections.ramp && i > 0) {
          await new Promise((r) => setTimeout(r, interval));
          if (Date.now() - start >= duration) break;
        }
        const client = new BenchClient(this.config.target, metrics);
        // Wire AUTH handler if enabled
        if (this.config.auth?.enabled) {
          client.onAuth((_challenge) => {
            // TODO: Sign AUTH event with @nostr/tools when private_key or generate_keys is configured
            // For now, log and skip — AUTH signing requires nostr-tools integration
            metrics.recordAuthResponse();
          });
        }
        try {
          await client.connect();
          this.clients.push(client);
          metrics.updateMaxConcurrent(this.clients.length);
        } catch {
          // connection failed — already recorded in metrics
        }
      }
    } else if (targetConns < currentConns) {
      // Ramp down: close oldest connections
      const toRemove = currentConns - targetConns;
      for (let i = 0; i < toRemove; i++) {
        const client = this.clients.shift();
        client?.close();
      }
    }

    // Rate-controlled event/request sending
    const eventInterval = scenario.events.rate > 0 ? 1000 / scenario.events.rate : 0;
    const reqInterval = scenario.requests.rate > 0 ? 1000 / scenario.requests.rate : 0;

    let eventIdx = 0;
    let reqIdx = 0;
    let lastEventTime = Date.now();
    let lastReqTime = Date.now();

    // Display update interval
    const displayInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      this.display.update(scenario.name, elapsed, scenario.duration, metrics.getStats());
    }, 1000);

    // Main loop
    while (Date.now() - start < duration) {
      const now = Date.now();
      const activeClients = this.clients.filter((c) => c.connected);

      if (activeClients.length === 0) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      // Send events
      if (eventInterval > 0 && now - lastEventTime >= eventInterval) {
        const client = activeClients[eventIdx % activeClients.length];
        eventIdx++;
        client.sendEvent(scenario.events.kind, scenario.events.content_length).catch(() => {});
        lastEventTime = now;
      }

      // Send requests
      if (reqInterval > 0 && now - lastReqTime >= reqInterval) {
        const client = activeClients[reqIdx % activeClients.length];
        reqIdx++;
        client.sendReq(scenario.requests.filters).catch(() => {});
        lastReqTime = now;
      }

      await new Promise((r) => setTimeout(r, Math.min(eventInterval || 100, reqInterval || 100, 50)));
    }

    clearInterval(displayInterval);
    this.display.endScenario();

    return metrics;
  }

  closeAll(): void {
    for (const client of this.clients) client.close();
    this.clients = [];
  }
}
