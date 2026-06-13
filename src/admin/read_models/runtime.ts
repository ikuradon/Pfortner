import type { AdminServiceState } from '../state.ts';

export function getRuntimeInfo(state: AdminServiceState) {
  return {
    logging: state.runtime.logging,
    trust_proxy: state.runtime.trustProxy,
    admin: state.adminAuth.enabled ? { enabled: true, token_source: state.adminAuth.tokenSource } : { enabled: false },
  };
}
