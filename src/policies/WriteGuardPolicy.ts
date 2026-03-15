import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';

interface WriteGuardConfig {
  require_auth?: boolean;
  allowed_kinds?: number[];
  read_only_mode?: boolean;
}

export const writeGuardPlugin: PolicyPlugin = {
  name: 'write-guard',
  description: 'Restrict EVENT writes by auth status, kind, or maintenance mode',
  direction: 'client',
  configSchema: {
    type: 'object',
    properties: {
      require_auth: { type: 'boolean' },
      allowed_kinds: { type: 'array', items: { type: 'number' } },
      read_only_mode: { type: 'boolean' },
    },
  },
  async initialize(config: unknown, _infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as WriteGuardConfig;
    const allowedKindSet = cfg.allowed_kinds ? new Set(cfg.allowed_kinds) : null;

    return (instance) => {
      let authChallengeSent = false;

      return (message, connectionInfo) => {
        if (message[0] !== 'EVENT' || message.length < 2) {
          return { message, action: 'next' };
        }
        const event = message[1] as { id: string; kind: number };
        if (cfg.read_only_mode) {
          return {
            message,
            action: 'reject',
            response: JSON.stringify(['OK', event.id, false, 'blocked: relay is in read-only mode']),
          };
        }
        if (cfg.require_auth && !connectionInfo.clientAuthorized) {
          if (!authChallengeSent) {
            instance.sendAuthMessage();
            authChallengeSent = true;
          }
          return { message, action: 'reject', response: JSON.stringify(['OK', event.id, false, 'auth-required:']) };
        }
        if (allowedKindSet && !allowedKindSet.has(event.kind)) {
          return {
            message,
            action: 'reject',
            response: JSON.stringify(['OK', event.id, false, 'blocked: kind not allowed']),
          };
        }
        return { message, action: 'next' };
      };
    };
  },
};
