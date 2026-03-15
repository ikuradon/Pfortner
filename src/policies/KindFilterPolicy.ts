import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';
import { extractEvent } from '../plugins/types.ts';

interface KindFilterConfig {
  mode: 'allow' | 'deny';
  kinds: number[];
  require_auth_for?: number[];
}

export const kindFilterPlugin: PolicyPlugin = {
  name: 'kind-filter',
  description: 'Filter EVENT messages by kind with optional auth requirement',
  direction: 'both',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['allow', 'deny'] },
      kinds: { type: 'array', items: { type: 'number' } },
      require_auth_for: { type: 'array', items: { type: 'number' } },
    },
    required: ['mode', 'kinds'],
  },
  initialize(config: unknown, _infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as KindFilterConfig;
    const kindSet = new Set(cfg.kinds);
    const authKindSet = new Set(cfg.require_auth_for ?? []);

    return Promise.resolve((instance) => {
      let authChallengeSent = false;

      return (message, connectionInfo) => {
        const extracted = extractEvent(message);
        if (!extracted) {
          return { message, action: 'next' };
        }

        const event = extracted.event as { kind: number; id: string };

        if (authKindSet.has(event.kind) && !connectionInfo.clientAuthorized) {
          if (!authChallengeSent) {
            instance.sendAuthMessage();
            authChallengeSent = true;
          }
          return {
            message,
            action: 'reject',
            response: JSON.stringify(['OK', event.id, false, 'auth-required:']),
          };
        }

        const kindMatches = kindSet.has(event.kind);
        if (cfg.mode === 'deny' && kindMatches) {
          return {
            message,
            action: 'reject',
            response: JSON.stringify(['OK', event.id, false, 'blocked: kind not allowed']),
          };
        }
        if (cfg.mode === 'allow' && !kindMatches) {
          return {
            message,
            action: 'reject',
            response: JSON.stringify(['OK', event.id, false, 'blocked: kind not allowed']),
          };
        }

        return { message, action: 'next' };
      };
    });
  },
};
