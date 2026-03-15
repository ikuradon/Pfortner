// src/policies/RoutePlugin.ts
import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';
import { buildEvalContext } from '../conditions/context.ts';
import { evaluateCondition } from '../conditions/evaluator.ts';
import type { Condition } from '../conditions/types.ts';

interface RouteConfig {
  upstream: string;
  condition: Condition;
}

export const routePlugin: PolicyPlugin = {
  name: 'route',
  description: 'Route matching REQ messages to an alternative upstream relay',
  direction: 'client',
  configSchema: {
    type: 'object',
    properties: {
      upstream: { type: 'string' },
      condition: { type: 'object' },
    },
    required: ['upstream', 'condition'],
  },
  async initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as RouteConfig;

    return (instance) => {
      const routedSubIds = new Set<string>();
      const connectionId = instance.connectionInfo.connectionId;

      return async (message, connectionInfo) => {
        const msgType = message[0];

        // CLOSE: check if this subId was routed
        if (msgType === 'CLOSE' && message.length >= 2) {
          const subId = message[1] as string;
          if (!routedSubIds.has(subId)) return { message, action: 'next' };

          // Unsubscribe from routed relay
          try {
            const conn = await infra.upstreamPool?.getConnection(cfg.upstream);
            conn?.unsubscribe(connectionId, subId);
          } catch { /* connection may be down */ }
          routedSubIds.delete(subId);
          return { message, action: 'reject' };
        }

        // REQ: evaluate condition
        if (msgType === 'REQ' && message.length >= 3) {
          const ctx = buildEvalContext(message, connectionInfo);
          if (!evaluateCondition(cfg.condition, ctx)) {
            return { message, action: 'next' };
          }

          const subId = message[1] as string;
          const filters = message.slice(2);

          // Route to alternative upstream
          try {
            const conn = await infra.upstreamPool?.getConnection(cfg.upstream);
            if (!conn) return { message, action: 'next' }; // no pool available

            routedSubIds.add(subId);
            conn.subscribe(
              connectionId,
              subId,
              filters,
              (origSubId: string, event: unknown) => {
                instance.sendMessageToClient(JSON.stringify(['EVENT', origSubId, event]));
              },
              (origSubId: string) => {
                instance.sendMessageToClient(JSON.stringify(['EOSE', origSubId]));
              },
              (origSubId: string, closedMsg: string) => {
                instance.sendMessageToClient(JSON.stringify(['CLOSED', origSubId, closedMsg]));
                routedSubIds.delete(origSubId);
              },
            );
            return { message, action: 'reject' };
          } catch (e) {
            infra.logger.warn('Failed to route to upstream', { upstream: cfg.upstream, error: String(e) });
            return { message, action: 'next' }; // fallback to default upstream
          }
        }

        // EVENT and others: pass through to default upstream
        return { message, action: 'next' };
      };
    };
  },
};
