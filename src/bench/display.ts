// src/bench/display.ts
import type { ScenarioStats } from './metrics.ts';
import type { ScenarioResult } from './reporter.ts';

export class ProgressDisplay {
  update(scenarioName: string, elapsed: number, duration: number, stats: ScenarioStats): void {
    const name = scenarioName.padEnd(14);
    const time = `${elapsed}s/${duration}s`;
    const conns = `conns: ${stats.connections.established}`;
    const events = `events: ${stats.events.sent} sent, ${stats.events.rejected} rej`;
    const lat = stats.event_latency.p50 != null
      ? `p50: ${stats.event_latency.p50}ms p99: ${stats.event_latency.p99}ms`
      : '';

    const line = `\r[${name}] ${time} | ${conns} | ${events} | ${lat}`;
    Deno.stdout.writeSync(new TextEncoder().encode(line));
  }

  endScenario(): void {
    Deno.stdout.writeSync(new TextEncoder().encode('\n'));
  }

  summary(results: ScenarioResult[]): void {
    console.log('\n--- Summary ---');
    for (const r of results) {
      const s = r.stats;
      console.log(
        `${r.name}: ${s.connections.established} conns, ${s.events.sent} events, ${s.events.rejected} rejected`,
      );
    }
  }
}
