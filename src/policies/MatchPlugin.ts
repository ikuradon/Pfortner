import type { InfraContext, OutputMessage, Policy, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';
import { evaluateCondition } from '../conditions/evaluator.ts';
import type { Condition } from '../conditions/types.ts';
import { buildEvalContext } from '../conditions/context.ts';

async function runSubPipeline(policies: Policy[], message: unknown[], connectionInfo: any): Promise<OutputMessage> {
  for (const policy of policies) {
    const result = await policy(message, connectionInfo);
    if (result.action !== 'next') return result;
  }
  return { message, action: 'next' };
}

interface MatchCase {
  condition: Condition;
  pipeline: Array<{ policy: string; config?: Record<string, unknown> }>;
}

export const matchPlugin: PolicyPlugin = {
  name: 'match',
  description: 'Multi-way conditional branching: first matching case wins',
  direction: 'both',
  configSchema: {
    type: 'object',
    properties: {
      cases: { type: 'array' },
      default: { type: 'array' },
    },
    required: ['cases'],
  },
  async initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as {
      cases: MatchCase[];
      default?: Array<{ policy: string; config?: Record<string, unknown> }>;
    };
    const direction = infra.currentDirection ?? 'client';

    if (!infra.pipelineResolver) {
      throw new Error('MatchPlugin requires pipelineResolver in InfraContext');
    }

    const resolvedCases: Array<{ condition: Condition; factories: PolicyFactory[] }> = [];
    for (const c of cfg.cases) {
      const factories = await infra.pipelineResolver(c.pipeline, direction);
      resolvedCases.push({ condition: c.condition, factories });
    }
    const defaultFactories = cfg.default ? await infra.pipelineResolver(cfg.default, direction) : [];

    return (instance) => {
      const casePolicies = resolvedCases.map((c) => ({
        condition: c.condition,
        policies: c.factories.map((f) => f(instance)),
      }));
      const defaultPolicies = defaultFactories.map((f) => f(instance));

      return (message, connectionInfo) => {
        const ctx = buildEvalContext(message, connectionInfo);
        for (const c of casePolicies) {
          if (evaluateCondition(c.condition, ctx)) {
            return runSubPipeline(c.policies, message, connectionInfo);
          }
        }
        if (defaultPolicies.length > 0) {
          return runSubPipeline(defaultPolicies, message, connectionInfo);
        }
        return Promise.resolve({ message, action: 'next' });
      };
    };
  },
};
