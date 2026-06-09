import type { AdminServiceState } from './state.ts';

export function getThroughputData(state: AdminServiceState): unknown {
  return state.throughputTracker?.getData() ?? [];
}
