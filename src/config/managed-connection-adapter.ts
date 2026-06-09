import type { ManagedConnection } from '../connections/types.ts';
import type { InfraContext } from '../plugins/types.ts';
import type { RequestHandlerHooks } from './request-handler-types.ts';

type ManagedConnectionInstance = {
  connectionInfo: ManagedConnection['info'];
  sendMessageToClient(message: string): Promise<void>;
  closeSocket(code?: number): void;
  sendAuthMessage(): void;
  on(event: 'clientDisconnect', handler: () => void): void;
};

export function createManagedConnection(
  instance: ManagedConnectionInstance,
  clientIp: string,
  connectedAt = new Date().toISOString(),
): ManagedConnection {
  return {
    info: instance.connectionInfo,
    clientIp,
    connectedAt,
    sendNotice: (msg) => instance.sendMessageToClient(JSON.stringify(['NOTICE', msg])),
    close: (code) => instance.closeSocket(code),
    sendAuthChallenge: () => instance.sendAuthMessage(),
  };
}

export function registerManagedConnectionDisconnect(
  instance: ManagedConnectionInstance,
  {
    hooks,
    infra,
  }: {
    hooks?: RequestHandlerHooks;
    infra: Pick<InfraContext, 'upstreamPool'>;
  },
): void {
  if (!hooks?.connectionManager && !hooks?.onDisconnect && !infra.upstreamPool) return;

  const connectionId = instance.connectionInfo.connectionId;
  instance.on('clientDisconnect', () => {
    hooks?.connectionManager?.unregister(connectionId);
    hooks?.onDisconnect?.(connectionId);
    infra.upstreamPool?.notifyClientDisconnect(connectionId);
  });
}
