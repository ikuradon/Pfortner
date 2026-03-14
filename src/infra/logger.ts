import type { Logger } from '../plugins/types.ts';

export interface LoggerOptions {
  format: 'json' | 'text';
  level: 'debug' | 'info' | 'warn' | 'error';
  sink?: (line: string) => void;
}

const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(options: LoggerOptions): Logger {
  const minLevel = LEVELS[options.level];
  const sink = options.sink ?? ((line: string) => console.log(line));

  function log(level: string, msg: string, context?: Record<string, unknown>): void {
    if (LEVELS[level] < minLevel) return;
    if (options.format === 'json') {
      sink(JSON.stringify({ timestamp: new Date().toISOString(), level, message: msg, ...context }));
    } else {
      const ts = new Date().toISOString();
      const ctx = context ? ' ' + JSON.stringify(context) : '';
      sink(`${ts} ${level.toUpperCase()} ${msg}${ctx}`);
    }
  }

  return {
    debug: (msg, ctx) => log('debug', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
  };
}
