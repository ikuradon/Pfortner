import type { HttpClient, InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';
import { extractEvent } from '../plugins/types.ts';

interface ContentFilterConfig {
  blocked_words?: string[];
  blocked_patterns?: string[];
  apply_to_kinds?: number[];
  external_api?: {
    url: string;
    timeout: number;
    on_error: 'accept' | 'reject';
    max_concurrent_requests?: number;
    max_response_bytes?: number;
  };
}

const DEFAULT_EXTERNAL_API_MAX_CONCURRENT_REQUESTS = 8;
const DEFAULT_EXTERNAL_API_MAX_RESPONSE_BYTES = 64 * 1024;

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isModeratableEvent(event: unknown): event is { id: string; kind: number; content: string } {
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as { id?: unknown }).id === 'string' &&
    typeof (event as { kind?: unknown }).kind === 'number' &&
    typeof (event as { content?: unknown }).content === 'string'
  );
}

async function readJsonWithLimit(response: Response, maxBytes: number): Promise<any> {
  if (!response.body) {
    throw new Error('external moderation response body unavailable');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('external moderation response too large');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const contentFilterPlugin: PolicyPlugin = {
  name: 'content-filter',
  description: 'Filter EVENT content by blocked words and regex patterns',
  direction: 'both',
  configSchema: {
    type: 'object',
    properties: {
      blocked_words: { type: 'array', items: { type: 'string' } },
      blocked_patterns: { type: 'array', items: { type: 'string' } },
      apply_to_kinds: { type: 'array', items: { type: 'number' } },
      external_api: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          timeout: { type: 'number' },
          on_error: { type: 'string', enum: ['accept', 'reject'] },
          max_concurrent_requests: { type: 'number', minimum: 1 },
          max_response_bytes: { type: 'number', minimum: 1 },
        },
        required: ['url', 'timeout', 'on_error'],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as ContentFilterConfig;
    const lowerWords = (cfg.blocked_words ?? []).map((w) => w.toLowerCase());
    const patterns = (cfg.blocked_patterns ?? []).map((p) => new RegExp(p, 'i'));
    const kindSet = cfg.apply_to_kinds ? new Set(cfg.apply_to_kinds) : null;
    const httpClient: HttpClient | undefined = cfg.external_api ? infra.httpClient : undefined;
    const apiConfig = cfg.external_api;
    const maxConcurrentRequests = positiveInteger(
      apiConfig?.max_concurrent_requests,
      DEFAULT_EXTERNAL_API_MAX_CONCURRENT_REQUESTS,
    );
    const maxResponseBytes = positiveInteger(apiConfig?.max_response_bytes, DEFAULT_EXTERNAL_API_MAX_RESPONSE_BYTES);
    let activeRequests = 0;

    return Promise.resolve((_instance) => {
      return async (message, _connectionInfo) => {
        const extracted = extractEvent(message);
        if (!extracted) return { message, action: 'next' };

        const event = extracted.event as { id: string; kind: number; content: string };

        // Skip kinds not in apply_to_kinds
        if (kindSet && !kindSet.has(event.kind)) {
          return { message, action: 'next' };
        }

        const contentLower = (event.content ?? '').toLowerCase();

        // Check blocked words
        for (const word of lowerWords) {
          if (contentLower.includes(word)) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['OK', event.id, false, 'blocked: prohibited content']),
            };
          }
        }

        // Check blocked patterns
        for (const pattern of patterns) {
          if (pattern.test(event.content ?? '')) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['OK', event.id, false, 'blocked: prohibited content']),
            };
          }
        }

        // External API check
        if (apiConfig && httpClient) {
          if (!isModeratableEvent(extracted.event)) {
            return { message, action: 'next' };
          }
          if (activeRequests >= maxConcurrentRequests) {
            if (apiConfig.on_error === 'reject') {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', event.id, false, 'blocked: moderation service unavailable']),
              };
            }
            return { message, action: 'next' };
          }

          try {
            activeRequests++;
            const response = await httpClient.fetch(apiConfig.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: event.content, event_id: event.id, kind: event.kind }),
              timeout: apiConfig.timeout,
            });
            const result = await readJsonWithLimit(response, maxResponseBytes);
            if (!result.allowed) {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', event.id, false, 'blocked: external moderation']),
              };
            }
          } catch {
            if (apiConfig.on_error === 'reject') {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', event.id, false, 'blocked: moderation service unavailable']),
              };
            }
            // on_error: 'accept' — fall through
          } finally {
            activeRequests--;
          }
        }

        return { message, action: 'next' };
      };
    });
  },
};
