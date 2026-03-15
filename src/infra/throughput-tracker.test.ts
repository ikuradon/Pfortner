import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { ThroughputTracker } from './throughput-tracker.ts';

Deno.test('ThroughputTracker records and retrieves data', () => {
  const tracker = new ThroughputTracker(5, 1000); // 5 buckets, 1s each
  tracker.recordAccept();
  tracker.recordAccept();
  tracker.recordReject();
  const data = tracker.getData();
  assertEquals(data.length, 5);
  // Current bucket should have counts
  const current = data[data.length - 1];
  assertEquals(current.accept >= 2, true);
  assertEquals(current.reject >= 1, true);
});

Deno.test('ThroughputTracker returns correct bucket count', () => {
  const tracker = new ThroughputTracker(30, 10000); // 30 buckets, 10s each (default)
  const data = tracker.getData();
  assertEquals(data.length, 30);
});

Deno.test('ThroughputTracker buckets have timestamps', () => {
  const tracker = new ThroughputTracker(5, 1000);
  tracker.recordAccept();
  const data = tracker.getData();
  assertEquals(typeof data[0].timestamp, 'number');
  assertEquals(data[0].timestamp > 0, true);
});

Deno.test('ThroughputTracker getTotals returns summary', () => {
  const tracker = new ThroughputTracker(5, 1000);
  tracker.recordAccept();
  tracker.recordAccept();
  tracker.recordReject();
  const totals = tracker.getTotals();
  assertEquals(totals.totalAccept >= 2, true);
  assertEquals(totals.totalReject >= 1, true);
});
