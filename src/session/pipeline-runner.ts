import type { ConnectionInfo, Policy } from '../pfortner.ts';

export type PolicyTuple<P extends Policy = Policy> = [policy: P, options?: InferPolicyOptions<P>];
export type InferPolicyOptions<P> = P extends Policy<infer Options> ? Options : never;
export type Policies<T extends any[]> = {
  [K in keyof T]: PolicyTuple<T[K]> | Policy<T[K]>;
};

export type PipelineSenders = {
  sendAccepted(message: string): Promise<void>;
  sendRejected(message: string): Promise<void>;
  onResult?: (action: 'accept' | 'reject', message: unknown[]) => void;
};

function toTuple<P extends Policy>(item: PolicyTuple<P> | P): PolicyTuple<P> {
  return typeof item === 'function' ? [item] : item;
}

export async function runPolicyPipeline(
  policies: Policies<any[]>,
  msg: unknown[],
  connectionInfo: ConnectionInfo,
  senders: PipelineSenders,
): Promise<void> {
  for (const item of policies as (Policy | PolicyTuple)[]) {
    const [policy, options] = toTuple(item);
    const result = await policy(msg, connectionInfo, options);
    if (result.action === 'accept') {
      senders.onResult?.('accept', result.message);
      await senders.sendAccepted(JSON.stringify(result.message));
      break;
    } else if (result.action === 'reject') {
      senders.onResult?.('reject', result.message);
      if (result.response != null) {
        await senders.sendRejected(result.response);
      }
      break;
    }
  }
}
