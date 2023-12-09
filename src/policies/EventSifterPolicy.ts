import { ip } from './deps.ts';
import { type Policy } from '../../mod.ts';
import { nostrTools } from '../deps.ts';

type sourceType = 'IP4' | 'IP6' | 'Import' | 'Stream' | 'Sync';

const detectIpType = (ipAddr: string): sourceType => {
  if (ip.isV4Format(ipAddr)) {
    return 'IP4';
  } else if (ip.isV6Format(ipAddr)) {
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
  if (message[0] !== 'EVENT' || message.length !== 3) {
    return { message, action: 'next' };
  }

  const event = message[1] as nostrTools.Event;
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
    if (result.action !== 'accept') {
      return { message, action: 'reject', response: JSON.stringify(['OK', event.id, false, result.msg]) };
    }
  }

  return { message, action: 'accept' };
};
