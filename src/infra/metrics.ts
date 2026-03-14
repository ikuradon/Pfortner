import type { MetricsCollector } from '../plugins/types.ts';

export function createNoopMetrics(): MetricsCollector {
  return { counter: () => {}, gauge: () => {}, histogram: () => {} };
}

export interface InMemoryMetrics extends MetricsCollector {
  getCounter(name: string): number;
  getGauge(name: string): number;
  getHistogramCount(name: string): number;
}

export function createInMemoryMetrics(): InMemoryMetrics {
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();
  const histograms = new Map<string, number[]>();
  return {
    counter(name: string, _labels?: Record<string, string>) {
      counters.set(name, (counters.get(name) ?? 0) + 1);
    },
    gauge(name: string, value: number, _labels?: Record<string, string>) {
      gauges.set(name, value);
    },
    histogram(name: string, value: number, _labels?: Record<string, string>) {
      const arr = histograms.get(name) ?? [];
      arr.push(value);
      histograms.set(name, arr);
    },
    getCounter(name: string) {
      return counters.get(name) ?? 0;
    },
    getGauge(name: string) {
      return gauges.get(name) ?? 0;
    },
    getHistogramCount(name: string) {
      return histograms.get(name)?.length ?? 0;
    },
  };
}
