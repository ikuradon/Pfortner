import type { ScenarioStats } from './metrics.ts';

export interface ScenarioResult {
  name: string;
  duration: number;
  stats: ScenarioStats;
}

export function formatJsonReport(target: string, results: ScenarioResult[], policyMetrics?: unknown): string {
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  return JSON.stringify(
    {
      version: 1,
      target,
      started_at: new Date().toISOString(),
      total_duration_seconds: totalDuration,
      scenarios: results.map((r) => ({
        name: r.name,
        duration: r.duration,
        ...r.stats,
      })),
      policy_metrics: policyMetrics ?? null,
    },
    null,
    2,
  );
}

function fmtLatency(lat: { p50: number | null; p95: number | null; p99: number | null }): string {
  if (lat.p50 == null) return 'N/A';
  return `p50: ${lat.p50}ms, p95: ${lat.p95}ms, p99: ${lat.p99}ms`;
}

export function formatMarkdownReport(target: string, results: ScenarioResult[]): string {
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const lines: string[] = [
    `# Bench Report — ${new Date().toISOString()}`,
    '',
    `**Target:** ${target} | **Duration:** ${totalDuration}s`,
    '',
  ];

  for (const r of results) {
    const s = r.stats;
    lines.push(`## ${r.name} (${r.duration}s)`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|---|---|');
    lines.push(`| Connections | ${s.connections.established} established, ${s.connections.failed} failed |`);
    lines.push(`| Connection Latency | ${fmtLatency(s.connections.latency_ms)} |`);
    if (s.events.sent > 0) {
      lines.push(`| Events | ${s.events.sent} sent, ${s.events.ok} OK, ${s.events.rejected} rejected |`);
      lines.push(`| Event Latency | ${fmtLatency(s.events.latency_ms)} |`);
    }
    if (s.requests.sent > 0) {
      lines.push(`| Requests | ${s.requests.sent} sent, ${s.requests.eose} EOSE |`);
      lines.push(`| Request Latency | ${fmtLatency(s.requests.latency_ms)} |`);
    }
    if (s.auth.challenges > 0) {
      lines.push(`| AUTH | ${s.auth.challenges} challenges, ${s.auth.responses} responses |`);
    }
    if (s.errors.ws_errors + s.errors.timeouts + s.errors.backpressure_skips > 0) {
      lines.push(
        `| Errors | ${s.errors.ws_errors} WS, ${s.errors.timeouts} timeout, ${s.errors.backpressure_skips} backpressure |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
