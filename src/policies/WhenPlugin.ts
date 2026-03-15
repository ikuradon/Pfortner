import type { InfraContext, OutputMessage, Policy, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';
import { extractEvent } from '../plugins/types.ts';
import { evaluateCondition } from '../conditions/evaluator.ts';
import type { Condition, EvalContext } from '../conditions/types.ts';

function buildEvalContext(
  message: unknown[],
  connectionInfo: { clientAuthorized: boolean; clientPubkey: string; connectionIpAddr: string },
): EvalContext {
  const extracted = extractEvent(message);
  return {
    authenticated: connectionInfo.clientAuthorized,
    pubkey: connectionInfo.clientPubkey,
    clientIp: connectionInfo.connectionIpAddr,
    messageType: (message[0] as string) ?? '',
    eventKind: extracted?.event?.kind ?? null,
    eventPubkey: extracted?.event?.pubkey ?? null,
  };
}

async function runSubPipeline(policies: Policy[], message: unknown[], connectionInfo: any): Promise<OutputMessage> {
  for (const policy of policies) {
    const result = await policy(message, connectionInfo);
    if (result.action !== 'next') return result;
  }
  return { message, action: 'next' };
}

export const whenPlugin: PolicyPlugin = {
  name: 'when',
  description: 'Conditional branching: run then or else pipeline based on condition',
  direction: 'both',
  configSchema: {
    type: 'object',
    properties: {
      condition: { type: 'object' },
      then: { type: 'array' },
      else: { type: 'array' },
    },
    required: ['condition', 'then'],
  },
  async initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as {
      condition: Condition;
      then: Array<{ policy: string; config?: Record<string, unknown> }>;
      else?: Array<{ policy: string; config?: Record<string, unknown> }>;
    };
    const direction = infra.currentDirection ?? 'client';

    if (!infra.pipelineResolver) {
      throw new Error('WhenPlugin requires pipelineResolver in InfraContext');
    }

    const thenFactories = await infra.pipelineResolver(cfg.then, direction);
    const elseFactories = cfg.else ? await infra.pipelineResolver(cfg.else, direction) : [];

    return (instance) => {
      const thenPolicies = thenFactories.map((f) => f(instance));
      const elsePolicies = elseFactories.map((f) => f(instance));

      return async (message, connectionInfo) => {
        const ctx = buildEvalContext(message, connectionInfo);
        if (evaluateCondition(cfg.condition, ctx)) {
          return runSubPipeline(thenPolicies, message, connectionInfo);
        }
        if (elsePolicies.length > 0) {
          return runSubPipeline(elsePolicies, message, connectionInfo);
        }
        return { message, action: 'next' };
      };
    };
  },
};
