import type { HttpClient, InfraContext, MetricsCollector } from '../plugins/types.ts';
import { createLogger, type LoggerOptions } from './logger.ts';
import { createNoopMetrics } from './metrics.ts';

export interface InfraOptions {
  logging?: Partial<LoggerOptions>;
  logSink?: (line: string) => void;
  httpTimeout?: number;
  httpUserAgent?: string;
  metrics?: MetricsCollector;
}

function createDefaultHttpClient(options: InfraOptions): HttpClient {
  const timeout = options.httpTimeout ?? 5000;
  const userAgent = options.httpUserAgent ?? 'Pfortner/1.0';
  return {
    async fetch(url: string, init?: RequestInit & { timeout?: number }): Promise<Response> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), init?.timeout ?? timeout);
      try {
        const headers = new Headers(init?.headers);
        if (!headers.has('User-Agent')) headers.set('User-Agent', userAgent);
        return await fetch(url, { ...init, signal: controller.signal, headers });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function buildInfraContext(options: InfraOptions): InfraContext {
  const logger = createLogger({
    format: options.logging?.format ?? 'json',
    level: options.logging?.level ?? 'info',
    sink: options.logSink,
  });
  const metrics = options.metrics ?? createNoopMetrics();
  return { logger, metrics, httpClient: createDefaultHttpClient(options) };
}
