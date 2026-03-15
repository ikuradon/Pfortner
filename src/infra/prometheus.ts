import type { MetricsCollector } from '../plugins/types.ts';

export interface PrometheusMetrics extends MetricsCollector {
  render(): string;
}

function labelKey(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return '{' + Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}

export function createPrometheusMetrics(): PrometheusMetrics {
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();
  // Maps from base key (name + labelKey) to { count, sum }
  const histograms = new Map<string, { count: number; sum: number }>();

  return {
    counter(name: string, labels?: Record<string, string>) {
      const key = name + labelKey(labels);
      counters.set(key, (counters.get(key) ?? 0) + 1);
    },
    gauge(name: string, value: number, labels?: Record<string, string>) {
      const key = name + labelKey(labels);
      gauges.set(key, value);
    },
    histogram(name: string, value: number, labels?: Record<string, string>) {
      const lk = labelKey(labels);
      const key = name + lk;
      const existing = histograms.get(key) ?? { count: 0, sum: 0 };
      existing.count++;
      existing.sum += value;
      histograms.set(key, existing);
    },
    render(): string {
      const lines: string[] = [];
      for (const [key, value] of counters) {
        lines.push(`${key} ${value}`);
      }
      for (const [key, value] of gauges) {
        lines.push(`${key} ${value}`);
      }
      for (const [key, data] of histograms) {
        // key is "name{labels}" or just "name"
        // We need to insert _count and _sum before the label part
        const braceIdx = key.indexOf('{');
        const namePart = braceIdx === -1 ? key : key.slice(0, braceIdx);
        const labelPart = braceIdx === -1 ? '' : key.slice(braceIdx);
        lines.push(`${namePart}_count${labelPart} ${data.count}`);
        lines.push(`${namePart}_sum${labelPart} ${data.sum}`);
      }
      return lines.join('\n') + '\n';
    },
  };
}
