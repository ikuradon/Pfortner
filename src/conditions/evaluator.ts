import type { Condition, EvalContext, SimpleCondition } from './types.ts';
import { simpleConditionKeys } from './schema.ts';

const simpleConditionKeySet = new Set(simpleConditionKeys);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidConditionShape(condition: unknown): condition is Condition {
  if (!isObject(condition)) return false;

  const keys = Object.keys(condition);
  const logicalKeys = keys.filter((key) => key === 'and' || key === 'or' || key === 'not');

  if (logicalKeys.length > 1) return false;
  if (logicalKeys.length === 1) {
    if (keys.length !== 1) return false;

    if ('and' in condition) {
      return Array.isArray(condition.and) &&
        condition.and.length > 0 &&
        condition.and.every((item) => isValidConditionShape(item));
    }
    if ('or' in condition) {
      return Array.isArray(condition.or) &&
        condition.or.length > 0 &&
        condition.or.every((item) => isValidConditionShape(item));
    }
    return isValidConditionShape(condition.not);
  }

  return keys.length > 0 && keys.every((key) => simpleConditionKeySet.has(key));
}

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
  if (!isValidConditionShape(condition)) return false;

  if ('and' in condition && Array.isArray((condition as any).and)) {
    return ((condition as any).and as Condition[]).every((c) => evaluateCondition(c, ctx));
  }
  if ('or' in condition && Array.isArray((condition as any).or)) {
    return ((condition as any).or as Condition[]).some((c) => evaluateCondition(c, ctx));
  }
  if ('not' in condition && isObject((condition as any).not)) {
    return !evaluateCondition((condition as any).not as Condition, ctx);
  }
  return evaluateSimple(condition as SimpleCondition, ctx);
}
