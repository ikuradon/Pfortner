export function shutdownAdmin(state: {
  shutdownManager?: { initiateShutdown(): Promise<void> };
}): { status: 'shutting down' } | { error: string; status: number } {
  if (state.shutdownManager) {
    state.shutdownManager.initiateShutdown().catch(console.error);
    return { status: 'shutting down' };
  }
  return { error: 'shutdown not configured', status: 500 };
}
