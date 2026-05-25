import { type Policy } from '../../mod.ts';
import { nostrTools } from '../deps.ts';
import { extractEvent } from '../plugins/types.ts';

type sourceType = 'IP4' | 'IP6' | 'Import' | 'Stream' | 'Sync';

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

const detectIpType = (ipAddr: string): sourceType => {
  if (IPV4_REGEX.test(ipAddr)) {
    return 'IP4';
  } else if (ipAddr.includes(':')) {
    return 'IP6';
  } else {
    return 'Stream';
  }
};

interface ESInputMessage {
  type: 'new' | 'lookback';
  event: nostrTools.Event;
  receivedAt: number;
  sourceType: 'IP4' | 'IP6' | 'Import' | 'Stream' | 'Sync';
  sourceInfo: string;
}

interface ESOutputMessage {
  id: string;
  action: 'accept' | 'reject' | 'shadowReject';
  msg: string;
}

type ESPolicy<ESOpts = unknown> = (msg: ESInputMessage, opts?: ESOpts) => Promise<ESOutputMessage> | ESOutputMessage;
type ESPolicyTuple<P extends ESPolicy = ESPolicy> = [policy: P, opts?: ESInferPolicyOpts<P>];
type ESInferPolicyOpts<P> = P extends ESPolicy<infer ESOpts> ? ESOpts : never;
type ESPolicies<T extends any[]> = {
  [K in keyof T]: ESPolicyTuple<T[K]> | ESPolicy<T[K]>;
};

function toTuple<P extends ESPolicy>(item: ESPolicyTuple<P> | P): ESPolicyTuple<P> {
  return typeof item === 'function' ? [item] : item;
}

export const eventSifterPolicy: Policy<ESPolicies<unknown[]>> = async (
  message,
  connectionInfo,
  esPolicies,
) => {
  const extracted = extractEvent(message);
  if (!extracted) {
    return { message, action: 'next' };
  }

  const event = extracted.event as nostrTools.Event;
  const msg: ESInputMessage = {
    type: 'new',
    event,
    receivedAt: Date.now() / 1000,
    sourceType: detectIpType(connectionInfo.connectionIpAddr),
    sourceInfo: connectionInfo.connectionIpAddr,
  };

  for (const item of esPolicies as (ESPolicy | ESPolicyTuple)[]) {
    const [policy, opts] = toTuple(item);
    const result = await policy(msg, opts);
    if (result.action === 'shadowReject') {
      const response = message.length === 2 ? JSON.stringify(['OK', event.id, true, '']) : undefined;
      return { message, action: 'reject', response };
    }
    if (result.action !== 'accept') {
      return { message, action: 'reject', response: JSON.stringify(['OK', event.id, false, result.msg]) };
    }
  }

  // Client-to-relay EVENT writes must keep flowing so downstream enforcement
  // policies such as auth, read-only mode, and rate limits can still run.
  return { message, action: message.length === 2 ? 'next' : 'accept' };
};
