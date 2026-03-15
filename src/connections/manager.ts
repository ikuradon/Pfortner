// src/connections/manager.ts
import type { ManagedConnection } from './types.ts';

export interface ConnectionOptions {
  max: number;
  maxPerIp: number;
  pressure: { softLimitPercent: number; authGracePeriod: number };
}

export interface ConnectionStats {
  active: number;
  authenticated: number;
  max: number;
  perIpMax: number;
  pressure: 'normal' | 'elevated' | 'critical';
}

export class ConnectionManager {
  private ipCounts = new Map<string, number>();
  private challengeSentAt = new Map<string, number>();
  private pressureInterval: number | null = null;

  constructor(
    private connections: Map<string, ManagedConnection>,
    private options: ConnectionOptions,
  ) {}

  canAccept(clientIp: string): { allowed: boolean; reason?: string; statusCode?: number } {
    if (this.connections.size >= this.options.max) {
      return { allowed: false, reason: 'max connections reached', statusCode: 503 };
    }
    const ipCount = this.ipCounts.get(clientIp) ?? 0;
    if (ipCount >= this.options.maxPerIp) {
      return { allowed: false, reason: 'max connections per IP reached', statusCode: 429 };
    }
    return { allowed: true };
  }

  register(managed: ManagedConnection): void {
    this.connections.set(managed.info.connectionId, managed);
    const ip = managed.clientIp;
    this.ipCounts.set(ip, (this.ipCounts.get(ip) ?? 0) + 1);
  }

  unregister(connectionId: string): void {
    const managed = this.connections.get(connectionId);
    if (!managed) return;
    this.connections.delete(connectionId);
    this.challengeSentAt.delete(connectionId);
    const ip = managed.clientIp;
    const count = (this.ipCounts.get(ip) ?? 1) - 1;
    if (count <= 0) this.ipCounts.delete(ip);
    else this.ipCounts.set(ip, count);
  }

  runPressureCheck(): void {
    const softLimit = Math.floor(this.options.max * this.options.pressure.softLimitPercent / 100);
    if (this.connections.size <= softLimit) {
      this.challengeSentAt.clear();
      return;
    }

    const now = Date.now();
    const graceMs = this.options.pressure.authGracePeriod * 1000;

    for (const [id, managed] of this.connections) {
      if (managed.info.clientAuthorized) {
        this.challengeSentAt.delete(id);
        continue;
      }

      const sentAt = this.challengeSentAt.get(id);
      if (!sentAt) {
        managed.sendAuthChallenge();
        this.challengeSentAt.set(id, now);
      } else if (now - sentAt > graceMs) {
        managed.close(1008);
      }
    }
  }

  startPressureCheck(intervalMs = 5000): void {
    this.stopPressureCheck();
    this.pressureInterval = setInterval(() => this.runPressureCheck(), intervalMs);
  }

  stopPressureCheck(): void {
    if (this.pressureInterval != null) {
      clearInterval(this.pressureInterval);
      this.pressureInterval = null;
    }
  }

  getStats(): ConnectionStats {
    let authenticated = 0;
    for (const managed of this.connections.values()) {
      if (managed.info.clientAuthorized) authenticated++;
    }
    const softLimit = Math.floor(this.options.max * this.options.pressure.softLimitPercent / 100);
    let pressure: ConnectionStats['pressure'] = 'normal';
    if (this.connections.size >= this.options.max) pressure = 'critical';
    else if (this.connections.size > softLimit) pressure = 'elevated';

    return {
      active: this.connections.size,
      authenticated,
      max: this.options.max,
      perIpMax: this.options.maxPerIp,
      pressure,
    };
  }
}
