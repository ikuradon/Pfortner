import type { LogEntry } from '../infra/log-buffer.ts';
import type { AdminServiceState } from './state.ts';

export interface LogsResult {
  logs: LogEntry[];
  total: number;
  subscribers: number;
}

const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 1000;

export function parseLogLimit(value: string | number | null | undefined, fallback = DEFAULT_LOG_LIMIT): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  const parsed = Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
  return Math.max(1, Math.min(MAX_LOG_LIMIT, parsed));
}

export function getLogs(state: AdminServiceState, limit = DEFAULT_LOG_LIMIT): LogsResult {
  if (!state.logBuffer) {
    return { logs: [], total: 0, subscribers: 0 };
  }
  return {
    logs: state.logBuffer.list(parseLogLimit(limit)),
    total: state.logBuffer.size(),
    subscribers: state.logBuffer.subscriberCount(),
  };
}

export function createLogStreamResponse(
  state: AdminServiceState,
  options: { signal?: AbortSignal; replay?: number; heartbeatMs?: number } = {},
): Response {
  const logBuffer = state.logBuffer;
  if (!logBuffer) {
    return new Response(JSON.stringify({ error: 'log streaming not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let cleanupHeartbeat = () => {};

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };

      const abortHandler = () => close();

      function close() {
        if (closed) return;
        closed = true;
        unsubscribe();
        cleanupHeartbeat();
        options.signal?.removeEventListener('abort', abortHandler);
        try {
          controller.close();
        } catch {
          // stream が既に閉じている場合は何もしない。
        }
      }

      cleanup = close;

      if (options.signal?.aborted) {
        close();
        return;
      }

      options.signal?.addEventListener('abort', abortHandler, { once: true });

      for (const entry of logBuffer.list(parseLogLimit(options.replay, 100))) {
        send('log', entry);
      }

      send('heartbeat', { timestamp: new Date().toISOString() });

      unsubscribe = logBuffer.subscribe((entry) => {
        send('log', entry);
      });

      const heartbeatId = setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, options.heartbeatMs ?? 15000);
      cleanupHeartbeat = () => clearInterval(heartbeatId);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
