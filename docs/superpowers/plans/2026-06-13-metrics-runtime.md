# Metrics Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Metrics UI and `/metrics` exporter truthful by wiring relay runtime message, policy, connection, and throughput data into a single metrics path.

**Architecture:** Keep `/metrics` as an optional Prometheus text exporter and keep Admin throughput available independently of Prometheus. Add a small relay metrics instrumentation module that wraps policy factories, records message counters from existing socket events, updates connection gauges, and writes final accept/reject decisions into `ThroughputTracker`. Do not add persistence or an external time-series dependency.

**Tech Stack:** Deno 2.8.3, TypeScript, existing `MetricsCollector`, `PrometheusMetrics`, `ThroughputTracker`, `buildRequestHandler`, `pfortnerInit`, Admin Fresh UI routes.

---

## Target Behavior

- `infra.metrics.prometheus.enabled: true` exposes `/metrics` on the main port.
- Prometheus disabled leaves `/metrics` unavailable but does not disable Admin throughput.
- Admin `/admin/metrics` receives non-empty throughput buckets after relay policy decisions.
- Policy decisions are emitted as:
  - `pfortner_policy_decisions_total{direction="client",policy="accept",action="accept"} 1`
  - `pfortner_policy_decisions_total{direction="client",policy="write-guard",action="reject"} 1`
- Policy durations are emitted as:
  - `pfortner_policy_duration_seconds_count{direction="client",policy="accept"} 1`
  - `pfortner_policy_duration_seconds_sum{direction="client",policy="accept"} <seconds>`
- Relay messages are emitted as:
  - `pfortner_messages_total{direction="client",type="EVENT"} 1`
  - `pfortner_messages_total{direction="server",type="OK"} 1`
- Connections are emitted as:
  - `pfortner_connections_total`
  - `pfortner_connections_active`
- Malformed WebSocket upgrades must not increment `pfortner_connections_total`.

## File Responsibilities

- Create `src/infra/relay-metrics.ts`
  - Owns relay metrics names and label construction.
  - Provides `instrumentPolicyFactory()`.
  - Provides `recordRawMessageMetric()`.
  - Provides connection and pipeline result helpers.
  - Keeps Prometheus-specific rendering out of request handling.
- Create `src/infra/relay-metrics.test.ts`
  - Tests policy wrapper labels and duration metrics.
  - Tests raw message type extraction.
  - Tests throughput recording only for accept/reject final results.
- Modify `src/config/pipeline-resolver.ts`
  - Wrap every resolved policy factory with `instrumentPolicyFactory()`.
  - Preserve plugin direction validation and config validation behavior.
  - Ensure nested pipelines resolved through `infra.pipelineResolver` are instrumented too.
- Modify `src/config/starter.ts`
  - Register message metrics listeners on each `pfortnerInit()` instance.
  - Update connection total and active gauge only after `createSession()` succeeds.
  - Update active gauge after `clientDisconnect` unregisters the managed connection.
  - Pass pipeline final results to `ThroughputTracker`.
- Modify `src/config/request-handler-types.ts`
  - Add optional `throughputTracker?: ThroughputTracker` to `RequestHandlerHooks`.
- Modify `src/server/runtime.ts`
  - Create one `ThroughputTracker` per normal runtime.
  - Store it on `AdminState.throughputTracker`.
  - Pass it into `ConfigManager.create()` request handler hooks.
- Modify tests:
  - `src/config/pipeline-resolver.test.ts`: prove resolved factories emit policy decision metrics.
  - `src/config/starter.test.ts`: prove malformed upgrades do not increment connection metrics, and request handler wires connection gauges and pipeline callbacks without crashing.
  - `src/server/runtime.test.ts`: prove normal runtime exposes a throughput tracker to Admin state through `/admin/api/metrics/throughput` where feasible.
  - Keep existing `src/infra/prometheus.test.ts` and `src/infra/throughput-tracker.test.ts` passing.

## Task 1: Add Relay Metrics Helper

**Files:**
- Create: `src/infra/relay-metrics.ts`
- Create: `src/infra/relay-metrics.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that import `createPrometheusMetrics`, `ThroughputTracker`, and new helper functions:

```typescript
Deno.test('instrumentPolicyFactory records decisions and duration labels', async () => {
  const metrics = createPrometheusMetrics();
  const factory = instrumentPolicyFactory(
    () => () => ({ message: ['EVENT', {}], action: 'accept' }),
    { direction: 'client', policy: 'accept', metrics },
  );
  const policy = factory(makeInstance());

  await policy(['EVENT', {}], makeConnectionInfo());

  const output = metrics.render();
  assertEquals(
    output.includes('pfortner_policy_decisions_total{direction="client",policy="accept",action="accept"} 1'),
    true,
  );
  assertEquals(
    output.includes('pfortner_policy_duration_seconds_count{direction="client",policy="accept"} 1'),
    true,
  );
});

Deno.test('recordRawMessageMetric records Nostr message type labels', () => {
  const metrics = createPrometheusMetrics();
  recordRawMessageMetric(metrics, 'client', '["EVENT",{"id":"e1"}]');
  recordRawMessageMetric(metrics, 'server', '["OK","e1",true,""]');
  recordRawMessageMetric(metrics, 'server', 'not-json');

  const output = metrics.render();
  assertEquals(output.includes('pfortner_messages_total{direction="client",type="EVENT"} 1'), true);
  assertEquals(output.includes('pfortner_messages_total{direction="server",type="OK"} 1'), true);
  assertEquals(output.includes('pfortner_messages_total{direction="server",type="unknown"} 1'), true);
});

Deno.test('recordPipelineResult updates throughput only for final accept and reject', () => {
  const tracker = new ThroughputTracker(3, 1000);

  recordPipelineResult(tracker, 'accept');
  recordPipelineResult(tracker, 'reject');

  const totals = tracker.getTotals();
  assertEquals(totals.totalAccept, 1);
  assertEquals(totals.totalReject, 1);
});
```

Run: `deno test --allow-read src/infra/relay-metrics.test.ts`

Expected: FAIL because `src/infra/relay-metrics.ts` does not exist.

- [ ] **Step 2: Implement helper**

Implement:

```typescript
export type RelayMetricDirection = 'client' | 'server';
export type RelayPolicyAction = 'accept' | 'reject' | 'next';

export function instrumentPolicyFactory(
  factory: PolicyFactory,
  options: {
    direction: RelayMetricDirection;
    policy: string;
    metrics: MetricsCollector;
  },
): PolicyFactory;

export function recordRawMessageMetric(
  metrics: MetricsCollector,
  direction: RelayMetricDirection,
  rawMessage: string,
): void;

export function recordConnectionOpened(metrics: MetricsCollector, active: number): void;
export function recordConnectionClosed(metrics: MetricsCollector, active: number): void;
export function recordPipelineResult(tracker: ThroughputTracker | undefined, action: 'accept' | 'reject'): void;
```

Implementation rules:
- Parse raw messages with `JSON.parse`.
- Use `type="unknown"` for non-array, empty-array, non-string first element, or invalid JSON.
- Record policy duration in seconds using `performance.now()`.
- Do not throw from metrics helpers.

- [ ] **Step 3: Verify helper**

Run: `deno test --allow-read src/infra/relay-metrics.test.ts`

Expected: PASS.

## Task 2: Instrument Resolved Policy Factories

**Files:**
- Modify: `src/config/pipeline-resolver.ts`
- Modify: `src/config/pipeline-resolver.test.ts`

- [ ] **Step 1: Write failing resolver test**

Add a test that resolves `accept` with a Prometheus collector, invokes the resolved policy, and asserts `pfortner_policy_decisions_total` includes `direction`, `policy`, and `action`.

Run: `deno test --allow-read src/config/pipeline-resolver.test.ts`

Expected: FAIL because resolver does not wrap factories yet.

- [ ] **Step 2: Wrap factories**

In `resolvePipeline()`, replace:

```typescript
factories.push(factory);
```

with:

```typescript
factories.push(instrumentPolicyFactory(factory, {
  direction,
  policy: plugin.name,
  metrics: infra.metrics,
}));
```

Import `instrumentPolicyFactory` from `../infra/relay-metrics.ts`.

- [ ] **Step 3: Verify resolver**

Run: `deno test --allow-read src/config/pipeline-resolver.test.ts src/infra/relay-metrics.test.ts`

Expected: PASS.

## Task 3: Wire Runtime Message, Connection, and Throughput Metrics

**Files:**
- Modify: `src/config/request-handler-types.ts`
- Modify: `src/config/starter.ts`
- Modify: `src/config/starter.test.ts`
- Modify: `src/session/pipeline-runner.ts`
- Modify: `src/session/pipeline-runner.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for:
- `runPolicyPipeline()` calls an optional final result callback for accept and reject.
- `buildRequestHandler()` keeps malformed upgrade metrics at zero.
- `buildRequestHandler()` updates `pfortner_connections_active` after connection registration when `createSession()` succeeds. Use the existing malformed upgrade test as the guard for the zero case.

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv \
  src/session/pipeline-runner.test.ts src/config/starter.test.ts
```

Expected: FAIL because callbacks and active gauge wiring are missing.

- [ ] **Step 2: Extend pipeline senders**

Add optional callback:

```typescript
onResult?: (action: 'accept' | 'reject', message: unknown[]) => void;
```

Call it exactly when `runPolicyPipeline()` sees final `accept` or `reject`.

- [ ] **Step 3: Extend request hooks**

Add:

```typescript
throughputTracker?: ThroughputTracker;
```

to `RequestHandlerHooks`.

- [ ] **Step 4: Wire starter metrics**

In `buildRequestHandler()`:
- Register `clientMsg` and `serverMsg` listeners to call `recordRawMessageMetric()`.
- Pass `onResult` callbacks to client and server `runPolicyPipeline()` via `pfortnerInit()` options or a narrow internal callback path.
- Record `pfortner_connections_total` and `pfortner_connections_active` after successful `createSession()`.
- Register a `clientDisconnect` listener after `registerManagedConnectionDisconnect()` so active gauge is updated after unregister.

If adding callbacks to `pfortnerInit()` is the smallest path, keep them optional and document them as internal runtime hooks in the options type.

- [ ] **Step 5: Verify runtime metrics**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv \
  src/session/pipeline-runner.test.ts src/config/starter.test.ts
```

Expected: PASS.

## Task 4: Connect Production Admin Throughput

**Files:**
- Modify: `src/server/runtime.ts`
- Modify: `src/server/runtime.test.ts`

- [ ] **Step 1: Write failing runtime test**

Add a runtime-level assertion that normal mode config creates Admin state with a throughput tracker by checking `/admin/api/metrics/throughput` returns a bucket array, not just `[]` because no tracker exists.

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/server/runtime.test.ts
```

Expected: FAIL because `AdminState.throughputTracker` is not set in production runtime.

- [ ] **Step 2: Create production tracker**

In `createNormalRuntime()`:

```typescript
const throughputTracker = new ThroughputTracker();
```

Set:

```typescript
adminState.throughputTracker = throughputTracker;
hooks.throughputTracker = throughputTracker;
```

Import `ThroughputTracker` from `../infra/throughput-tracker.ts`.

- [ ] **Step 3: Verify runtime**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/server/runtime.test.ts src/admin/ui/api_routes.test.ts
```

Expected: PASS.

## Task 5: Final Verification and Commit

**Files:**
- All changed files.

- [ ] **Step 1: Format**

Run: `deno fmt --check --config deno.json`

Expected: PASS.

- [ ] **Step 2: Lint**

Run: `deno lint --config deno.json`

Expected: PASS.

- [ ] **Step 3: Metrics targeted tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv \
  src/infra/relay-metrics.test.ts \
  src/infra/prometheus.test.ts \
  src/infra/throughput-tracker.test.ts \
  src/session/pipeline-runner.test.ts \
  src/config/pipeline-resolver.test.ts \
  src/config/starter.test.ts \
  src/server/runtime.test.ts \
  src/admin/service.test.ts \
  src/admin/server.test.ts \
  src/admin/ui/api_routes.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Commit in two atomic commits:

```bash
git add docs/superpowers/plans/2026-06-13-metrics-runtime.md
git commit -m "plan metrics runtime instrumentation"

git add src/infra/relay-metrics.ts src/infra/relay-metrics.test.ts src/config/pipeline-resolver.ts src/config/pipeline-resolver.test.ts src/config/request-handler-types.ts src/config/starter.ts src/config/starter.test.ts src/session/pipeline-runner.ts src/session/pipeline-runner.test.ts src/server/runtime.ts src/server/runtime.test.ts
git commit -m "instrument relay runtime metrics"
```

Expected: working tree clean after the second commit.

## Self-Review

- Scope is limited to in-process runtime metrics and Admin throughput. It does not add persistence, remote exporters, dashboards, or new config keys.
- Prometheus remains opt-in through existing `infra.metrics.prometheus.enabled`.
- Admin throughput becomes available regardless of Prometheus setting.
- Existing Bearer and Fresh Admin API surfaces are preserved.
- Existing logging ownership remains env-only.
