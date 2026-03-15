import type { HttpClient, InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';
import { extractEvent } from '../plugins/types.ts';

interface ContentFilterConfig {
  banned_words?: string[];
  banned_patterns?: string[];
  apply_to_kinds?: number[];
  external_api?: { url: string; timeout: number; on_error: 'accept' | 'reject' };
}

export const contentFilterPlugin: PolicyPlugin = {
  name: 'content-filter',
  description: 'Filter EVENT content by banned words and regex patterns',
  direction: 'both',
  configSchema: {
    type: 'object',
    properties: {
      banned_words: { type: 'array', items: { type: 'string' } },
      banned_patterns: { type: 'array', items: { type: 'string' } },
      apply_to_kinds: { type: 'array', items: { type: 'number' } },
    },
  },
  initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as ContentFilterConfig;
    const lowerWords = (cfg.banned_words ?? []).map((w) => w.toLowerCase());
    const patterns = (cfg.banned_patterns ?? []).map((p) => new RegExp(p, 'i'));
    const kindSet = cfg.apply_to_kinds ? new Set(cfg.apply_to_kinds) : null;
    const httpClient: HttpClient | undefined = cfg.external_api ? infra.httpClient : undefined;
    const apiConfig = cfg.external_api;

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

        // Check banned words
        for (const word of lowerWords) {
          if (contentLower.includes(word)) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['OK', event.id, false, 'blocked: prohibited content']),
            };
          }
        }

        // Check banned patterns
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
          try {
            const response = await httpClient.fetch(apiConfig.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: event.content, event_id: event.id, kind: event.kind }),
              timeout: apiConfig.timeout,
            });
            const result = await response.json();
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
          }
        }

        return { message, action: 'next' };
      };
    });
  },
};
