import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';

interface ProtectedEventConfig {
  require_auth: boolean;
}

export const protectedEventPlugin: PolicyPlugin = {
  name: 'protected-event',
  description: 'Block NIP-70 protected events from reaching unauthenticated clients',
  direction: 'server',
  configSchema: {
    type: 'object',
    properties: { require_auth: { type: 'boolean' } },
    required: ['require_auth'],
  },
  initialize(config: unknown, _infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as ProtectedEventConfig;
    return Promise.resolve((_instance) => {
      return (message, connectionInfo) => {
        if (message[0] !== 'EVENT' || message.length < 3) return { message, action: 'next' };
        if (!cfg.require_auth) return { message, action: 'next' };
        const event = message[2] as { tags: string[][] };
        const isProtected = event.tags?.some((tag) => tag.length >= 1 && tag[0] === '-');
        if (!isProtected) return { message, action: 'next' };
        if (!connectionInfo.clientAuthorized) return { message, action: 'reject' };
        return { message, action: 'next' };
      };
    });
  },
};
