// src/shutdown/manager.ts
import type { ManagedConnection } from '../connections/types.ts';

interface ShutdownOptions {
  drainTimeout: number;
  forceAfter: number;
}

interface ShutdownTestOptions {
  exit?: boolean; // default true; set false in tests to skip Deno.exit
}

export class ShutdownManager {
  private draining = false;
  private testOptions: ShutdownTestOptions;

  constructor(
    private connections: Map<string, ManagedConnection>,
    private options: ShutdownOptions,
    private cleanup: () => Promise<void>,
    testOptions?: ShutdownTestOptions,
  ) {
    this.testOptions = testOptions ?? { exit: true };
  }

  isDraining(): boolean {
    return this.draining;
  }

  start(): void {
    const handler = () => {
      this.initiateShutdown().catch(console.error);
    };
    try {
      Deno.addSignalListener('SIGTERM', handler);
    } catch { /* unsupported platform */ }
    try {
      Deno.addSignalListener('SIGINT', handler);
    } catch { /* unsupported platform */ }
  }

  async initiateShutdown(): Promise<void> {
    if (this.draining) return; // idempotent
    this.draining = true;

    // Send notice to all existing connections
    const noticePromises: Promise<void>[] = [];
    for (const managed of this.connections.values()) {
      noticePromises.push(managed.sendNotice('server shutting down').catch(() => {}));
    }
    await Promise.allSettled(noticePromises);

    // Wait for connections to drain
    const totalTimeout = (this.options.drainTimeout + this.options.forceAfter) * 1000;
    const drainStart = Date.now();

    await new Promise<void>((resolve) => {
      if (this.connections.size === 0) {
        resolve();
        return;
      }

      const checkInterval = setInterval(() => {
        if (this.connections.size === 0 || Date.now() - drainStart >= totalTimeout) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });

    // Force close remaining connections
    for (const managed of [...this.connections.values()]) {
      managed.close(1001);
    }

    // Run cleanup
    await this.cleanup();

    // Exit
    if (this.testOptions.exit !== false) {
      Deno.exit(0);
    }
  }
}
