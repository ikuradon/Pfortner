export interface ThroughputBucket {
  timestamp: number;
  accept: number;
  reject: number;
}

export class ThroughputTracker {
  private buckets: ThroughputBucket[];
  private currentIndex: number;
  private lastBucketTime: number;

  constructor(
    private bucketCount: number = 30,
    private bucketIntervalMs: number = 10000,
  ) {
    const now = Date.now();
    this.buckets = Array.from({ length: bucketCount }, (_, i) => ({
      timestamp: now - (bucketCount - 1 - i) * bucketIntervalMs,
      accept: 0,
      reject: 0,
    }));
    this.currentIndex = bucketCount - 1;
    this.lastBucketTime = now;
  }

  private advance(): void {
    const now = Date.now();
    const elapsed = now - this.lastBucketTime;
    const bucketsToAdvance = Math.floor(elapsed / this.bucketIntervalMs);

    for (let i = 0; i < Math.min(bucketsToAdvance, this.bucketCount); i++) {
      this.currentIndex = (this.currentIndex + 1) % this.bucketCount;
      this.buckets[this.currentIndex] = {
        timestamp: this.lastBucketTime + (i + 1) * this.bucketIntervalMs,
        accept: 0,
        reject: 0,
      };
    }

    if (bucketsToAdvance > 0) {
      this.lastBucketTime += bucketsToAdvance * this.bucketIntervalMs;
    }
  }

  recordAccept(): void {
    this.advance();
    this.buckets[this.currentIndex].accept++;
  }

  recordReject(): void {
    this.advance();
    this.buckets[this.currentIndex].reject++;
  }

  getData(): ThroughputBucket[] {
    this.advance();
    const result: ThroughputBucket[] = [];
    for (let i = 0; i < this.bucketCount; i++) {
      const idx = (this.currentIndex + 1 + i) % this.bucketCount;
      result.push({ ...this.buckets[idx] });
    }
    return result;
  }

  getTotals(): { totalAccept: number; totalReject: number } {
    this.advance();
    let totalAccept = 0;
    let totalReject = 0;
    for (const bucket of this.buckets) {
      totalAccept += bucket.accept;
      totalReject += bucket.reject;
    }
    return { totalAccept, totalReject };
  }
}
