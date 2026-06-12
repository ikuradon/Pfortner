import type { LogEntry } from '../../infra/log-buffer.ts';
import type { AdminServiceState } from '../state.ts';

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
