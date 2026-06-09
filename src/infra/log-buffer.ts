export interface LogEntry {
  id: number;
  line: string;
  received_at: string;
}

export type LogSubscriber = (entry: LogEntry) => void;

export class LogBuffer {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private subscribers = new Set<LogSubscriber>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : 1000;
  }

  push(line: string): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      line,
      received_at: new Date().toISOString(),
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(entry);
      } catch {
        // subscriber 側の失敗で logging path を止めない。
      }
    }

    return entry;
  }

  list(limit = this.maxEntries): LogEntry[] {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(0, Math.min(this.maxEntries, Math.floor(limit)))
      : this.maxEntries;
    if (safeLimit === 0) return [];
    return this.entries.slice(-safeLimit);
  }

  subscribe(callback: LogSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  size(): number {
    return this.entries.length;
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }
}
