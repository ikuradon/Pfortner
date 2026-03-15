import type { Condition, EvalContext, SimpleCondition } from './types.ts';

function evaluateSimple(condition: SimpleCondition, ctx: EvalContext): boolean {
  if (condition.authenticated !== undefined && condition.authenticated !== ctx.authenticated) return false;
  if (condition.pubkey !== undefined && condition.pubkey !== ctx.pubkey) return false;
  if (condition.client_ip !== undefined && condition.client_ip !== ctx.clientIp) return false;
  if (condition.message_type !== undefined && condition.message_type !== ctx.messageType) return false;
  if (condition.event_kind !== undefined) {
    if (ctx.eventKind === null || condition.event_kind !== ctx.eventKind) return false;
  }
  if (condition.event_pubkey !== undefined) {
    if (ctx.eventPubkey === null || condition.event_pubkey !== ctx.eventPubkey) return false;
  }
  if (condition.has_search !== undefined && condition.has_search !== ctx.hasSearch) return false;
  return true;
}

export function evaluateCondition(condition: Condition, ctx: EvalContext): boolean {
  // Logical operators take precedence: and > or > not > simple
  if ('and' in condition && Array.isArray((condition as any).and)) {
    return ((condition as any).and as Condition[]).every((c) => evaluateCondition(c, ctx));
  }
  if ('or' in condition && Array.isArray((condition as any).or)) {
    return ((condition as any).or as Condition[]).some((c) => evaluateCondition(c, ctx));
  }
  if ('not' in condition && typeof (condition as any).not === 'object') {
    return !evaluateCondition((condition as any).not as Condition, ctx);
  }
  return evaluateSimple(condition as SimpleCondition, ctx);
}
