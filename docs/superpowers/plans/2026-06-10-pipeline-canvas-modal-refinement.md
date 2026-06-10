# Pipeline Canvas Modal Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine `/admin/pipelines` into a canvas-first pipeline editor with collapsible palette, node settings modal, fullscreen playground modal, DAG draft save, Publish, and Undo/Redo.

**Architecture:** Keep the existing Deno admin SPA and static ES module structure. Extract pure editor state, modal config, and draft normalization helpers so tests can cover behavior without a browser, then wire those helpers into `admin/static/pipelines.js` and the existing admin API route layer.

**Tech Stack:** Deno, Fresh admin shell, vanilla JavaScript DOM APIs, SVG, localStorage, existing `/admin/api/pipelines`, existing `/admin/api/playground/evaluate`.

---

## File Structure

- Create `admin/static/pipeline_workbench_state.js`: pure browser-side helpers for history, fingerprints, draft shape, palette preference keys, and dirty state.
- Create `admin/static/pipeline_config_editor.js`: pure helpers for settings modal JSON parsing and generic interactive form value conversion.
- Create `src/admin/pipeline_draft.ts`: server-side draft path derivation, draft normalization, read/write helpers, and permission-safe error conversion.
- Modify `src/admin/state.ts`: add optional `pipelineDraftPath`.
- Modify `scripts/serve.ts`: derive `pipelineDraftPath` from `configPath` when running in config mode.
- Modify `deno.json`: grant `serve:config` write permission for `pfortner.yaml.workbench.json`.
- Modify `src/config/serve-permissions.test.ts`: assert config mode grants draft sidecar write permission.
- Modify `admin/api_routes.ts`: add `GET/POST /admin/api/pipeline-draft` and rename UI-facing pipeline save semantics to Publish without changing endpoint path.
- Modify `admin/api_routes.test.ts`: test draft read/write and existing publish behavior.
- Modify `src/admin/pipelines-static.test.ts`: add unit tests for node actions, modal helpers, history, draft fingerprints, and dirty state.
- Modify `admin/static/page_templates.js` and `admin/routes/pipelines.tsx`: remove inspector/drawer markup, add collapsible palette shell, modal roots, toolbar buttons.
- Modify `admin/static/styles.css`: add canvas-first layout, collapsed palette, node action, settings modal, fullscreen playground modal, and status styles.
- Modify `admin/static/pipelines.js`: integrate helpers, render node actions, open modals, Save DAG, Publish, localStorage/server draft load, and Undo/Redo.

---

### Task 1: Pure Workbench State Helpers

**Files:**

- Create: `admin/static/pipeline_workbench_state.js`
- Modify: `src/admin/pipelines-static.test.ts`

- [ ] **Step 1: Write failing tests for history, fingerprint, draft, and dirty state**

Add this import near the top of `src/admin/pipelines-static.test.ts`:

```ts
import {
  applyHistoryChange,
  buildPipelineDraft,
  fingerprintPipelines,
  hasUnpublishedChanges,
  initialHistoryState,
  isUndoAvailable,
  normalizeWorkbenchDraft,
  recordHistorySnapshot,
} from '../../admin/static/pipeline_workbench_state.js';
```

Append these tests:

```ts
Deno.test('pipeline workbench history records undo and redo snapshots', () => {
  const first = { client: { nodes: [{ id: 'client-start', x: 0 }], edges: [] }, server: { nodes: [], edges: [] } };
  const second = { client: { nodes: [{ id: 'client-start', x: 80 }], edges: [] }, server: { nodes: [], edges: [] } };
  let history = initialHistoryState(first);

  history = recordHistorySnapshot(history, second);
  assertEquals(isUndoAvailable(history), true);

  const undone = applyHistoryChange(history, 'undo');
  assertEquals(undone.present.client.nodes[0].x, 0);
  assertEquals(undone.future.length, 1);

  const redone = applyHistoryChange(undone, 'redo');
  assertEquals(redone.present.client.nodes[0].x, 80);
  assertEquals(redone.future.length, 0);
});

Deno.test('pipeline workbench fingerprints are stable for equivalent pipelines', () => {
  const a = { client: [{ policy: 'accept', config: {} }], server: [] };
  const b = { server: [], client: [{ config: {}, policy: 'accept' }] };

  assertEquals(fingerprintPipelines(a), fingerprintPipelines(b));
});

Deno.test('pipeline workbench draft normalizes expected graph shape', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept', config: {} }],
    server: [],
  });
  const published = fingerprintPipelines(graphToPipelines(graphs));

  const draft = buildPipelineDraft({
    graphs,
    viewports: { client: { zoom: 1, pan: { x: 10, y: 20 } }, server: { zoom: 1, pan: { x: 0, y: 0 } } },
    publishedFingerprint: published,
    now: 1000,
  });
  const normalized = normalizeWorkbenchDraft(draft);

  assertEquals('error' in normalized, false);
  if (!('error' in normalized)) {
    assertEquals(normalized.draft.version, 1);
    assertEquals(normalized.draft.graphs.client.nodes[0].id, 'client-start');
    assertEquals(normalized.draft.viewports.client.pan.x, 10);
    assertEquals(normalized.draft.lastPublishedFingerprint, published);
  }
});

Deno.test('pipeline workbench detects unpublished changes', () => {
  const published = fingerprintPipelines({ client: [], server: [] });
  const changed = fingerprintPipelines({ client: [{ policy: 'accept', config: {} }], server: [] });

  assertEquals(hasUnpublishedChanges(changed, published), true);
  assertEquals(hasUnpublishedChanges(published, published), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: FAIL with an import error for `../../admin/static/pipeline_workbench_state.js`.

- [ ] **Step 3: Implement `pipeline_workbench_state.js`**

Create `admin/static/pipeline_workbench_state.js`:

```js
export const WORKBENCH_DRAFT_VERSION = 1;
export const LOCAL_DRAFT_KEY = 'pfortner.pipelineWorkbenchDraft.v1';
export const PALETTE_COLLAPSED_KEY = 'pfortner.pipelinePaletteCollapsed.v1';
export const LAST_DIRECTION_KEY = 'pfortner.pipelineDirection.v1';

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function fingerprintPipelines(pipelines) {
  return JSON.stringify(stableValue({
    client: Array.isArray(pipelines?.client) ? pipelines.client : [],
    server: Array.isArray(pipelines?.server) ? pipelines.server : [],
  }));
}

export function initialHistoryState(initialGraphs) {
  return { past: [], present: cloneValue(initialGraphs), future: [] };
}

export function recordHistorySnapshot(history, nextGraphs) {
  const next = cloneValue(nextGraphs);
  if (JSON.stringify(stableValue(history.present)) === JSON.stringify(stableValue(next))) {
    return history;
  }
  return {
    past: history.past.concat([cloneValue(history.present)]).slice(-100),
    present: next,
    future: [],
  };
}

export function applyHistoryChange(history, direction) {
  if (direction === 'undo') {
    if (history.past.length === 0) return history;
    const previous = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      present: cloneValue(previous),
      future: [cloneValue(history.present)].concat(history.future),
    };
  }
  if (direction === 'redo') {
    if (history.future.length === 0) return history;
    const next = history.future[0];
    return {
      past: history.past.concat([cloneValue(history.present)]),
      present: cloneValue(next),
      future: history.future.slice(1),
    };
  }
  return history;
}

export function isUndoAvailable(history) {
  return Array.isArray(history?.past) && history.past.length > 0;
}

export function isRedoAvailable(history) {
  return Array.isArray(history?.future) && history.future.length > 0;
}

export function buildPipelineDraft({ graphs, viewports, publishedFingerprint, now = Date.now() }) {
  return {
    version: WORKBENCH_DRAFT_VERSION,
    graphs: cloneValue(graphs),
    viewports: cloneValue(viewports),
    updatedAt: new Date(now).toISOString(),
    lastPublishedFingerprint: publishedFingerprint,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGraph(graph, direction) {
  if (!isRecord(graph)) return { error: `${direction} graph must be an object` };
  if (!Array.isArray(graph.nodes)) return { error: `${direction}.nodes must be an array` };
  if (!Array.isArray(graph.edges)) return { error: `${direction}.edges must be an array` };
  return {
    graph: {
      direction,
      nodes: cloneValue(graph.nodes),
      edges: cloneValue(graph.edges),
    },
  };
}

export function normalizeWorkbenchDraft(value) {
  if (!isRecord(value)) return { error: 'draft object required' };
  if (value.version !== WORKBENCH_DRAFT_VERSION) return { error: 'unsupported draft version' };
  if (!isRecord(value.graphs)) return { error: 'draft.graphs object required' };
  const client = normalizeGraph(value.graphs.client, 'client');
  if ('error' in client) return client;
  const server = normalizeGraph(value.graphs.server, 'server');
  if ('error' in server) return server;
  return {
    draft: {
      version: WORKBENCH_DRAFT_VERSION,
      graphs: { client: client.graph, server: server.graph },
      viewports: isRecord(value.viewports) ? cloneValue(value.viewports) : {},
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
      lastPublishedFingerprint: typeof value.lastPublishedFingerprint === 'string'
        ? value.lastPublishedFingerprint
        : '',
    },
  };
}

export function hasUnpublishedChanges(currentFingerprint, publishedFingerprint) {
  return currentFingerprint !== publishedFingerprint;
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add admin/static/pipeline_workbench_state.js src/admin/pipelines-static.test.ts
git commit -m "Add pipeline workbench state helpers"
```

---

### Task 2: Settings Modal Pure Helpers

**Files:**

- Create: `admin/static/pipeline_config_editor.js`
- Modify: `src/admin/pipelines-static.test.ts`

- [ ] **Step 1: Write failing tests for node actions and config editing helpers**

Add this import near the top of `src/admin/pipelines-static.test.ts`:

```ts
import {
  configToEditorRows,
  parseConfigJson,
  shouldOpenPlaygroundForNode,
  shouldRenderRunAction,
  shouldRenderSettingsAction,
  updateConfigFromEditorRows,
} from '../../admin/static/pipeline_config_editor.js';
```

Append these tests:

```ts
Deno.test('pipeline node actions separate start run from policy settings', () => {
  const start = { type: 'start', policy: 'start' };
  const policy = { type: 'policy', policy: 'write-guard' };

  assertEquals(shouldRenderRunAction(start), true);
  assertEquals(shouldRenderSettingsAction(start), false);
  assertEquals(shouldOpenPlaygroundForNode(start), true);

  assertEquals(shouldRenderRunAction(policy), false);
  assertEquals(shouldRenderSettingsAction(policy), true);
  assertEquals(shouldOpenPlaygroundForNode(policy), false);
});

Deno.test('pipeline config editor parses JSON with readable errors', () => {
  assertEquals(parseConfigJson('{"require_auth":true}'), {
    config: { require_auth: true },
  });

  const bad = parseConfigJson('{');
  assertEquals('error' in bad, true);
});

Deno.test('pipeline config editor converts generic interactive rows', () => {
  const rows = configToEditorRows({
    require_auth: true,
    window: 60,
    upstream: 'wss://relay.example',
    kinds: [1, 3],
    condition: { message_type: 'REQ' },
  });

  const updated = updateConfigFromEditorRows(rows.map((row: any) => {
    if (row.key === 'window') return { ...row, value: '120' };
    if (row.key === 'require_auth') return { ...row, value: false };
    return row;
  }));

  assertEquals(updated, {
    config: {
      require_auth: false,
      window: 120,
      upstream: 'wss://relay.example',
      kinds: [1, 3],
      condition: { message_type: 'REQ' },
    },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: FAIL with an import error for `../../admin/static/pipeline_config_editor.js`.

- [ ] **Step 3: Implement `pipeline_config_editor.js`**

Create `admin/static/pipeline_config_editor.js`:

```js
function isStartNode(node) {
  return node?.type === 'start' || node?.policy === 'start';
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function shouldRenderSettingsAction(node) {
  return Boolean(node) && !isStartNode(node);
}

export function shouldRenderRunAction(node) {
  return isStartNode(node);
}

export function shouldOpenPlaygroundForNode(node) {
  return isStartNode(node);
}

export function parseConfigJson(raw) {
  try {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { config: {} };
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Config JSON must be an object.' };
    }
    return { config: parsed };
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` };
  }
}

export function configToEditorRows(config) {
  return Object.entries(config ?? {}).map(([key, value]) => {
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    return {
      key,
      type,
      value: type === 'array' || type === 'object' ? JSON.stringify(value, null, 2) : value,
    };
  });
}

function parseRowValue(row) {
  if (row.type === 'boolean') return { value: Boolean(row.value) };
  if (row.type === 'number') {
    const n = Number(row.value);
    if (!Number.isFinite(n)) return { error: `${row.key} must be a number.` };
    return { value: n };
  }
  if (row.type === 'array' || row.type === 'object') {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : cloneValue(row.value);
      if (row.type === 'array' && !Array.isArray(parsed)) return { error: `${row.key} must be an array.` };
      if (row.type === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
        return { error: `${row.key} must be an object.` };
      }
      return { value: parsed };
    } catch (e) {
      return { error: `${row.key}: ${e.message}` };
    }
  }
  if (row.type === 'null') return { value: null };
  return { value: String(row.value ?? '') };
}

export function updateConfigFromEditorRows(rows) {
  const config = {};
  for (const row of rows ?? []) {
    if (!row?.key) return { error: 'Config field key is required.' };
    const parsed = parseRowValue(row);
    if ('error' in parsed) return parsed;
    config[row.key] = parsed.value;
  }
  return { config };
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add admin/static/pipeline_config_editor.js src/admin/pipelines-static.test.ts
git commit -m "Add pipeline settings modal helpers"
```

---

### Task 3: Server-Side DAG Draft API

**Files:**

- Create: `src/admin/pipeline_draft.ts`
- Modify: `src/admin/state.ts`
- Modify: `scripts/serve.ts`
- Modify: `deno.json`
- Modify: `src/config/serve-permissions.test.ts`
- Modify: `admin/api_routes.ts`
- Modify: `admin/api_routes.test.ts`

- [ ] **Step 1: Write failing tests for draft API and permissions**

Add this import to `admin/api_routes.test.ts`:

```ts
import { pipelineDraftPathForConfig } from '../src/admin/pipeline_draft.ts';
```

Append these tests to `admin/api_routes.test.ts`:

```ts
Deno.test('pipeline draft API returns null when draft storage is not configured', async () => {
  const state = makeState();
  const app = makeTestApp();
  registerAdminApiRoutes(app, '/admin', state);

  const res = await app.request('/admin/api/pipeline-draft', { method: 'GET' });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { draft: null });
});

Deno.test('pipeline draft API saves and reads workbench draft sidecar', async () => {
  const configPath = await Deno.makeTempFile({ suffix: '.yaml' });
  const draftPath = pipelineDraftPathForConfig(configPath);
  const state = makeState();
  state.pipelineDraftPath = draftPath;
  const app = makeTestApp();
  registerAdminApiRoutes(app, '/admin', state);

  const draft = {
    version: 1,
    graphs: {
      client: { direction: 'client', nodes: [{ id: 'client-start', type: 'start', policy: 'start' }], edges: [] },
      server: { direction: 'server', nodes: [{ id: 'server-start', type: 'start', policy: 'start' }], edges: [] },
    },
    viewports: { client: { zoom: 1, pan: { x: 0, y: 0 } }, server: { zoom: 1, pan: { x: 0, y: 0 } } },
    updatedAt: '2026-06-10T00:00:00.000Z',
    lastPublishedFingerprint: '{"client":[],"server":[]}',
  };

  const saveRes = await app.request('/admin/api/pipeline-draft', {
    method: 'POST',
    body: JSON.stringify({ draft }),
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(saveRes.status, 200);
  assertEquals((await saveRes.json()).status, 'saved');

  const getRes = await app.request('/admin/api/pipeline-draft', { method: 'GET' });
  assertEquals(getRes.status, 200);
  assertEquals(await getRes.json(), { draft });

  await Deno.remove(configPath);
  await Deno.remove(draftPath);
});
```

Update `src/config/serve-permissions.test.ts`:

```ts
Deno.test('serve:config grants write access for admin pipeline saves and draft sidecar', async () => {
  const denoJson = JSON.parse(await Deno.readTextFile('deno.json')) as {
    tasks: Record<string, string>;
  };

  assertStringIncludes(denoJson.tasks['serve:config'], '--allow-write=pfortner.yaml,pfortner.yaml.workbench.json');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/api_routes.test.ts src/config/serve-permissions.test.ts
```

Expected: FAIL with missing `../src/admin/pipeline_draft.ts` and old `serve:config` permission.

- [ ] **Step 3: Implement `src/admin/pipeline_draft.ts`**

Create `src/admin/pipeline_draft.ts`:

```ts
export interface PipelineWorkbenchDraft {
  version: 1;
  graphs: {
    client: { direction?: string; nodes: unknown[]; edges: unknown[] };
    server: { direction?: string; nodes: unknown[]; edges: unknown[] };
  };
  viewports?: Record<string, unknown>;
  updatedAt: string;
  lastPublishedFingerprint: string;
}

export function pipelineDraftPathForConfig(configPath: string): string {
  return `${configPath}.workbench.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGraph(value: unknown, direction: 'client' | 'server') {
  if (!isRecord(value)) return { error: `${direction} graph must be an object` };
  if (!Array.isArray(value.nodes)) return { error: `${direction}.nodes must be an array` };
  if (!Array.isArray(value.edges)) return { error: `${direction}.edges must be an array` };
  return {
    graph: {
      direction,
      nodes: structuredClone(value.nodes),
      edges: structuredClone(value.edges),
    },
  };
}

export function normalizePipelineWorkbenchDraft(value: unknown): { draft: PipelineWorkbenchDraft } | { error: string } {
  if (!isRecord(value)) return { error: 'draft object required' };
  if (value.version !== 1) return { error: 'unsupported draft version' };
  if (!isRecord(value.graphs)) return { error: 'draft.graphs object required' };
  const client = normalizeGraph(value.graphs.client, 'client');
  if ('error' in client) return client;
  const server = normalizeGraph(value.graphs.server, 'server');
  if ('error' in server) return server;
  return {
    draft: {
      version: 1,
      graphs: { client: client.graph, server: server.graph },
      viewports: isRecord(value.viewports) ? structuredClone(value.viewports) : {},
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
      lastPublishedFingerprint: typeof value.lastPublishedFingerprint === 'string'
        ? value.lastPublishedFingerprint
        : '',
    },
  };
}

export async function readPipelineWorkbenchDraft(path: string): Promise<PipelineWorkbenchDraft | null> {
  try {
    const raw = await Deno.readTextFile(path);
    const parsed = JSON.parse(raw);
    const normalized = normalizePipelineWorkbenchDraft(parsed);
    if ('error' in normalized) throw new Error(normalized.error);
    return normalized.draft;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

export async function writePipelineWorkbenchDraft(path: string, draft: PipelineWorkbenchDraft): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(draft, null, 2) + '\n');
}
```

- [ ] **Step 4: Wire state, serve path, permission, and routes**

In `src/admin/state.ts`, add:

```ts
pipelineDraftPath?: string;
```

In `scripts/serve.ts`, import:

```ts
import { pipelineDraftPathForConfig } from '../src/admin/pipeline_draft.ts';
```

After `adminState.configPath = configPath;`, add:

```ts
adminState.pipelineDraftPath = pipelineDraftPathForConfig(configPath);
```

In `deno.json`, change `serve:config` to:

```json
"serve:config": "deno run --unstable-net --allow-env --allow-net --allow-read --allow-write=pfortner.yaml,pfortner.yaml.workbench.json scripts/serve.ts pfortner.yaml"
```

In `admin/api_routes.ts`, import:

```ts
import {
  normalizePipelineWorkbenchDraft,
  readPipelineWorkbenchDraft,
  writePipelineWorkbenchDraft,
} from '../src/admin/pipeline_draft.ts';
```

Register routes before `/api/pipelines`:

```ts
app.get(`${adminPath}/api/pipeline-draft`, async (_ctx) => {
  if (!state.pipelineDraftPath) return json({ draft: null });
  try {
    const draft = await readPipelineWorkbenchDraft(state.pipelineDraftPath);
    return json({ draft });
  } catch (e) {
    return json({ error: `pipeline draft read failed: ${(e as Error).message}` }, 500);
  }
});

app.post(`${adminPath}/api/pipeline-draft`, async (ctx) => {
  if (!state.pipelineDraftPath) {
    return json({ error: 'pipeline draft save not configured' }, 500);
  }
  try {
    const body = await ctx.req.json();
    const normalized = normalizePipelineWorkbenchDraft(body.draft);
    if ('error' in normalized) return json({ error: normalized.error }, 400);
    await writePipelineWorkbenchDraft(state.pipelineDraftPath, normalized.draft);
    return json({ status: 'saved', draft: normalized.draft });
  } catch (e) {
    return json({ error: `pipeline draft save failed: ${(e as Error).message}` }, 500);
  }
});
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/api_routes.test.ts src/config/serve-permissions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/admin/pipeline_draft.ts src/admin/state.ts scripts/serve.ts deno.json src/config/serve-permissions.test.ts admin/api_routes.ts admin/api_routes.test.ts
git commit -m "Add pipeline workbench draft API"
```

---

### Task 4: Canvas-first Markup and Styles

**Files:**

- Modify: `admin/static/page_templates.js`
- Modify: `admin/routes/pipelines.tsx`
- Modify: `admin/static/page_templates.test.ts`
- Modify: `admin/static/styles.css`

- [ ] **Step 1: Write failing static template tests**

Append to `admin/static/page_templates.test.ts`:

```ts
Deno.test('pipelines template exposes canvas-first modal workbench ids', () => {
  const routes = createPageRoutes();
  const root = fakeRoot();
  routes['/admin/pipelines'].render(root);
  const html = root.toString();

  for (
    const id of [
      'btn-toggle-palette',
      'btn-undo-pipeline',
      'btn-redo-pipeline',
      'btn-save-dag',
      'btn-publish-pipeline',
      'node-settings-modal',
      'playground-modal',
    ]
  ) {
    assertStringIncludes(html, id);
  }
  assertEquals(html.includes('node-inspector'), false);
  assertEquals(html.includes('test-run-drawer'), false);
});
```

- [ ] **Step 2: Run template tests to verify they fail**

Run:

```bash
deno test --allow-read admin/static/page_templates.test.ts
```

Expected: FAIL because the new IDs are not in the template and old inspector/drawer markup still exists.

- [ ] **Step 3: Update SPA template markup**

In `admin/static/page_templates.js`, replace the pipeline toolbar buttons with:

```js
button('↶ Undo', 'btn btn-ghost', { id: 'btn-undo-pipeline', disabled: true }),
button('↷ Redo', 'btn btn-ghost', { id: 'btn-redo-pipeline', disabled: true }),
button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh-pipelines' }),
button('⛶ Fit', 'btn btn-ghost', { id: 'btn-fit-canvas' }),
button('−', 'btn btn-ghost', { id: 'btn-zoom-out', title: 'Zoom out' }),
button('+', 'btn btn-ghost', { id: 'btn-zoom-in', title: 'Zoom in' }),
button('Save DAG', 'btn btn-ghost', { id: 'btn-save-dag' }),
button('Publish', 'btn btn-primary', { id: 'btn-publish-pipeline' }),
```

Replace `workbench-grid` with:

```js
el('div', { className: 'workbench-grid canvas-first-grid', id: 'canvas-first-grid' }, [
  el('aside', { className: 'workbench-panel palette-panel', id: 'palette-panel' }, [
    el('div', { className: 'workbench-panel-header palette-header' }, [
      el('span', {}, ['Policy Palette']),
      button('‹', 'btn btn-ghost btn-icon', { id: 'btn-toggle-palette', title: 'Collapse palette' }),
    ]),
    el('div', {
      className: 'workbench-panel-body policy-palette',
      id: 'policy-palette',
    }, [
      el('div', { className: 'pipeline-empty' }, ['Loading policies...']),
    ]),
  ]),
  el('section', { className: 'canvas-shell canvas-shell-expanded' }, [
    el('div', { className: 'canvas-toolbar' }, [
      el('span', { id: 'canvas-title' }, ['Client Pipeline']),
      el('span', { className: 'text-muted', id: 'canvas-zoom-label' }, ['100%']),
    ]),
    el('div', { className: 'pipeline-canvas', id: 'pipeline-canvas', tabindex: '0' }, [
      el('svg', {
        id: 'pipeline-svg',
        className: 'pipeline-svg',
        attrs: { role: 'application', 'aria-label': 'Pipeline graph editor' },
      }),
      el('div', { className: 'selection-marquee', id: 'selection-marquee' }),
      el('div', { className: 'canvas-minimap', id: 'canvas-minimap' }, [
        el('svg', { id: 'minimap-svg', className: 'minimap-svg' }),
      ]),
    ]),
  ]),
]),
el('div', { className: 'modal-backdrop hidden', id: 'node-settings-modal' }),
el('div', { className: 'modal-backdrop hidden', id: 'playground-modal' }),
```

Remove the `node-inspector` aside and `test-run-drawer` section from the template.

- [ ] **Step 4: Mirror SSR route markup**

In `admin/routes/pipelines.tsx`, mirror the same IDs and remove `node-inspector` / `test-run-drawer`. Keep class names identical to `page_templates.js`.

- [ ] **Step 5: Add styles**

Append to `admin/static/styles.css`:

```css
.canvas-first-grid {
  grid-template-columns: minmax(44px, 240px) minmax(0, 1fr);
}

.pipeline-workbench.palette-collapsed .canvas-first-grid {
  grid-template-columns: 44px minmax(0, 1fr);
}

.palette-header {
  justify-content: space-between;
}

.btn-icon {
  min-width: 28px;
  width: 28px;
  height: 28px;
  padding: 0;
}

.pipeline-workbench.palette-collapsed .palette-panel {
  overflow: hidden;
}

.pipeline-workbench.palette-collapsed .workbench-panel-header span,
.pipeline-workbench.palette-collapsed .policy-palette-name,
.pipeline-workbench.palette-collapsed .policy-palette-add {
  display: none;
}

.pipeline-workbench.palette-collapsed .policy-palette {
  padding: 8px 6px;
}

.pipeline-workbench.palette-collapsed .policy-palette-item {
  justify-content: center;
  min-height: 34px;
  padding: 6px;
}

.pipeline-node-action {
  cursor: pointer;
}

.pipeline-node-action-bg {
  fill: var(--color-surface);
  stroke: var(--color-border);
}

.pipeline-node-action:hover .pipeline-node-action-bg {
  stroke: var(--color-accent);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}

.modal-backdrop.hidden {
  display: none;
}

.workbench-modal {
  width: min(720px, 100%);
  max-height: min(760px, 100%);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
}

.workbench-modal.fullscreen {
  width: min(1180px, 100%);
  height: min(840px, 100%);
}

.workbench-modal-header,
.workbench-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}

.workbench-modal-footer {
  border-top: 1px solid var(--color-border);
  border-bottom: 0;
}

.workbench-modal-body {
  max-height: 620px;
  overflow: auto;
  padding: 14px;
}

.config-editor-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.config-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.playground-modal-grid {
  display: grid;
  grid-template-columns: minmax(300px, 420px) minmax(0, 1fr);
  gap: 14px;
}
```

- [ ] **Step 6: Run template tests and format**

Run:

```bash
deno test --allow-read admin/static/page_templates.test.ts
deno fmt --check --single-quote=true --line-width=120 --prose-wrap=preserve admin/static/page_templates.js admin/routes/pipelines.tsx admin/static/styles.css
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add admin/static/page_templates.js admin/routes/pipelines.tsx admin/static/page_templates.test.ts admin/static/styles.css
git commit -m "Convert pipeline page to canvas-first shell"
```

---

### Task 5: Node Actions, Settings Modal, and Fullscreen Playground

**Files:**

- Modify: `admin/static/pipelines.js`
- Modify: `src/admin/pipelines-static.test.ts`
- Modify: `admin/static/styles.css`

- [ ] **Step 1: Write failing tests for exported node action helpers**

Extend the dynamic import type in `src/admin/pipelines-static.test.ts` or add direct assertions:

```ts
Deno.test('pipeline editor exposes start run and policy settings action decisions', () => {
  assertEquals(pipelineEditor.shouldRenderSettingsAction?.({ type: 'start', policy: 'start' }), false);
  assertEquals(pipelineEditor.shouldRenderRunAction?.({ type: 'start', policy: 'start' }), true);
  assertEquals(pipelineEditor.shouldRenderSettingsAction?.({ type: 'policy', policy: 'accept' }), true);
  assertEquals(pipelineEditor.shouldRenderRunAction?.({ type: 'policy', policy: 'accept' }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: FAIL until `pipelines.js` re-exports or implements these helpers.

- [ ] **Step 3: Import helper modules in `pipelines.js`**

At the top of `admin/static/pipelines.js`, add:

```js
import {
  configToEditorRows,
  parseConfigJson,
  shouldOpenPlaygroundForNode,
  shouldRenderRunAction,
  shouldRenderSettingsAction,
  updateConfigFromEditorRows,
} from './pipeline_config_editor.js';
```

Then export helper names for tests:

```js
export { shouldOpenPlaygroundForNode, shouldRenderRunAction, shouldRenderSettingsAction };
```

- [ ] **Step 4: Add node action rendering**

In `renderNode(group, node)`, before port rendering, add:

```js
const actions = [];
if (shouldRenderRunAction(node)) actions.push({ kind: 'run', label: '▶', title: 'Run pipeline' });
if (shouldRenderSettingsAction(node)) actions.push({ kind: 'settings', label: '⚙', title: 'Edit node config' });
actions.forEach((action, index) => {
  const x = NODE_WIDTH - 22 - index * 26;
  const actionGroup = svgEl('g', {
    class: 'pipeline-node-action',
    dataset: { action: action.kind, nodeId: node.id },
    transform: `translate(${x}, 14)`,
  });
  actionGroup.appendChild(svgEl('circle', { class: 'pipeline-node-action-bg', r: 10, cx: 0, cy: 0 }));
  actionGroup.appendChild(svgEl('text', {
    class: 'pipeline-node-action-label',
    x: 0,
    y: 4,
    'text-anchor': 'middle',
  }, [document.createTextNode(action.label)]));
  nodeGroup.appendChild(actionGroup);
});
```

In the node pointerdown handler, add an action branch before drag/wire:

```js
const action = event.target?.closest?.('[data-action]');
if (action?.dataset?.action === 'settings') {
  event.preventDefault();
  event.stopPropagation();
  openNodeSettingsModal(node.id);
  return;
}
if (action?.dataset?.action === 'run') {
  event.preventDefault();
  event.stopPropagation();
  openPlaygroundModal();
  return;
}
```

Add a double click handler:

```js
nodeGroup.addEventListener('dblclick', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (shouldOpenPlaygroundForNode(node)) openPlaygroundModal();
  else openNodeSettingsModal(node.id);
});
```

- [ ] **Step 5: Replace inspector rendering with settings modal rendering**

Keep `renderInspector()` as a no-op for compatibility:

```js
function renderInspector() {
  // Inspector was replaced by per-node settings modal.
}
```

Add:

```js
let settingsModalState = null;
let playgroundOpen = false;

function closeNodeSettingsModal() {
  settingsModalState = null;
  renderNodeSettingsModal();
}

function openNodeSettingsModal(nodeId) {
  const node = findNode(currentGraph(), nodeId);
  if (!node || isStartNode(node)) return;
  settingsModalState = {
    nodeId,
    mode: 'interactive',
    json: JSON.stringify(node.config ?? {}, null, 2),
    error: '',
  };
  renderNodeSettingsModal();
}
```

Implement `renderNodeSettingsModal()` using `htmlEl()`:

```js
function renderNodeSettingsModal() {
  const root = document.getElementById('node-settings-modal');
  if (!root) return;
  clearChildren(root);
  root.classList.toggle('hidden', !settingsModalState);
  if (!settingsModalState) return;

  const node = findNode(currentGraph(), settingsModalState.nodeId);
  if (!node) {
    closeNodeSettingsModal();
    return;
  }
  const rows = configToEditorRows(node.config ?? {});
  const body = htmlEl('div', { className: 'workbench-modal' }, [
    htmlEl('div', { className: 'workbench-modal-header' }, [
      htmlEl('div', {}, [
        htmlEl('div', { className: 'inspector-title', text: node.policy }),
        htmlEl('div', { className: 'inspector-muted', text: node.id }),
      ]),
      htmlEl('button', {
        type: 'button',
        className: 'btn btn-ghost',
        text: '×',
        events: { click: closeNodeSettingsModal },
      }),
    ]),
    htmlEl('div', { className: 'workbench-modal-body' }, [
      htmlEl('div', { className: 'config-editor-tabs' }, [
        htmlEl('button', {
          type: 'button',
          className: settingsModalState.mode === 'interactive' ? 'btn btn-primary' : 'btn btn-ghost',
          text: 'Interactive',
          events: {
            click: () => {
              settingsModalState.mode = 'interactive';
              renderNodeSettingsModal();
            },
          },
        }),
        htmlEl('button', {
          type: 'button',
          className: settingsModalState.mode === 'json' ? 'btn btn-primary' : 'btn btn-ghost',
          text: 'JSON',
          events: {
            click: () => {
              settingsModalState.mode = 'json';
              renderNodeSettingsModal();
            },
          },
        }),
      ]),
      settingsModalState.error ? htmlEl('div', { className: 'playground-error', text: settingsModalState.error }) : '',
      settingsModalState.mode === 'json'
        ? htmlEl('textarea', { id: 'node-config-editor', className: 'config-editor-textarea', spellcheck: false }, [])
        : renderInteractiveConfigRows(rows),
    ]),
    htmlEl('div', { className: 'workbench-modal-footer' }, [
      htmlEl('button', {
        type: 'button',
        className: 'btn btn-danger',
        text: 'Delete Node',
        events: {
          click: () => {
            selectedNodeIds = new Set([node.id]);
            deleteSelectedNodes();
            closeNodeSettingsModal();
          },
        },
      }),
      htmlEl('div', { className: 'flex gap-2' }, [
        htmlEl('button', {
          type: 'button',
          className: 'btn btn-ghost',
          text: 'Cancel',
          events: { click: closeNodeSettingsModal },
        }),
        htmlEl('button', {
          type: 'button',
          className: 'btn btn-primary',
          text: 'Apply',
          events: { click: applyNodeSettingsModal },
        }),
      ]),
    ]),
  ]);
  root.appendChild(body);
  const textarea = document.getElementById('node-config-editor');
  if (textarea) textarea.value = settingsModalState.json;
}
```

Add `renderInteractiveConfigRows()` and `applyNodeSettingsModal()`:

```js
function renderInteractiveConfigRows(rows) {
  const box = htmlEl('div', { id: 'interactive-config-rows' });
  if (rows.length === 0) {
    box.appendChild(htmlEl('div', { className: 'pipeline-empty compact', text: 'No config fields.' }));
    return box;
  }
  for (const row of rows) {
    const input = row.type === 'boolean'
      ? htmlEl('input', { type: 'checkbox', checked: row.value === true, dataset: { key: row.key, type: row.type } })
      : htmlEl(row.type === 'array' || row.type === 'object' ? 'textarea' : 'input', {
        className: 'form-input',
        value: row.value,
        dataset: { key: row.key, type: row.type },
      });
    box.appendChild(htmlEl('label', { className: 'config-row' }, [
      htmlEl('span', { text: row.key }),
      input,
    ]));
  }
  return box;
}

function applyNodeSettingsModal() {
  const node = findNode(currentGraph(), settingsModalState?.nodeId);
  if (!node) return;
  let parsed;
  if (settingsModalState.mode === 'json') {
    const textarea = document.getElementById('node-config-editor');
    parsed = parseConfigJson(textarea?.value ?? '');
  } else {
    const rows = [...document.querySelectorAll('#interactive-config-rows [data-key]')].map((input) => ({
      key: input.dataset.key,
      type: input.dataset.type,
      value: input.type === 'checkbox' ? input.checked : input.value,
    }));
    parsed = updateConfigFromEditorRows(rows);
  }
  if ('error' in parsed) {
    settingsModalState.error = parsed.error;
    renderNodeSettingsModal();
    return;
  }
  recordGraphMutation();
  node.config = parsed.config;
  executionNodeIds.clear();
  closeNodeSettingsModal();
  render();
  setStatus('Updated ' + node.policy);
}
```

- [ ] **Step 6: Add fullscreen playground modal**

Replace `setDrawerOpen()` with:

```js
function openPlaygroundModal() {
  playgroundOpen = true;
  renderPlaygroundModal();
}

function closePlaygroundModal() {
  playgroundOpen = false;
  renderPlaygroundModal();
}
```

Add `renderPlaygroundModal()`:

```js
function renderPlaygroundModal() {
  const root = document.getElementById('playground-modal');
  if (!root) return;
  clearChildren(root);
  root.classList.toggle('hidden', !playgroundOpen);
  if (!playgroundOpen) return;
  root.appendChild(htmlEl('div', { className: 'workbench-modal fullscreen' }, [
    htmlEl('div', { className: 'workbench-modal-header' }, [
      htmlEl('div', { className: 'inspector-title', text: 'Playground' }),
      htmlEl('button', {
        type: 'button',
        className: 'btn btn-ghost',
        text: '×',
        events: { click: closePlaygroundModal },
      }),
    ]),
    htmlEl('div', { className: 'workbench-modal-body playground-modal-grid' }, [
      htmlEl('div', { className: 'test-run-inputs' }, [
        htmlEl('div', { className: 'section-title', text: 'Presets' }),
        htmlEl('div', { className: 'preset-buttons', id: 'preset-buttons' }),
        htmlEl('label', { className: 'section-title', htmlFor: 'message-input', text: 'Message JSON' }),
        htmlEl('textarea', {
          id: 'message-input',
          className: 'message-textarea',
          spellcheck: false,
          placeholder: '["EVENT", {...}]',
        }),
        htmlEl('div', { className: 'context-grid' }, [
          htmlEl('label', { className: 'context-label', htmlFor: 'ctx-authenticated', text: 'Authenticated' }),
          htmlEl('input', { type: 'checkbox', id: 'ctx-authenticated' }),
          htmlEl('label', { className: 'context-label', htmlFor: 'ctx-pubkey', text: 'Pubkey' }),
          htmlEl('input', { type: 'text', id: 'ctx-pubkey', className: 'context-input', placeholder: '(hex pubkey)' }),
          htmlEl('label', { className: 'context-label', htmlFor: 'ctx-ip', text: 'Client IP' }),
          htmlEl('input', {
            type: 'text',
            id: 'ctx-ip',
            className: 'context-input',
            placeholder: '127.0.0.1',
            value: '127.0.0.1',
          }),
        ]),
        htmlEl('button', {
          type: 'button',
          className: 'btn btn-primary',
          id: 'btn-run',
          text: '▷ Run',
          events: { click: runEvaluation },
        }),
      ]),
      htmlEl('div', { className: 'test-run-results' }, [
        htmlEl('div', { className: 'workbench-panel-header', text: 'Execution Result' }),
        htmlEl('div', { className: 'playground-panel-body', id: 'result-panel' }, [
          htmlEl('div', {
            className: 'playground-empty',
            id: 'result-empty',
            text: 'Enter a message and run it against the selected pipeline.',
          }),
        ]),
      ]),
    ]),
  ]));
  renderPresets();
}
```

In `runEvaluation()`, replace `setDrawerOpen(true);` with:

```js
if (!playgroundOpen) openPlaygroundModal();
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
deno lint admin/static/pipelines.js admin/static/pipeline_config_editor.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add admin/static/pipelines.js admin/static/styles.css src/admin/pipelines-static.test.ts
git commit -m "Move pipeline editing into node modals"
```

---

### Task 6: Palette Collapse, Save DAG, Publish, and Undo/Redo Integration

**Files:**

- Modify: `admin/static/pipelines.js`
- Modify: `src/admin/pipelines-static.test.ts`

- [ ] **Step 1: Write failing helper tests for palette and publish button IDs**

Append to `src/admin/pipelines-static.test.ts`:

```ts
Deno.test('pipeline workbench local preference keys are stable strings', () => {
  const state = await import('../../admin/static/pipeline_workbench_state.js') as unknown as Record<string, string>;
  assertEquals(state.PALETTE_COLLAPSED_KEY, 'pfortner.pipelinePaletteCollapsed.v1');
  assertEquals(state.LOCAL_DRAFT_KEY, 'pfortner.pipelineWorkbenchDraft.v1');
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: PASS if Task 1 is complete. This locks the helper constants before UI wiring.

- [ ] **Step 3: Import workbench state helpers**

In `admin/static/pipelines.js`, add:

```js
import {
  applyHistoryChange,
  buildPipelineDraft,
  fingerprintPipelines,
  initialHistoryState,
  isRedoAvailable,
  isUndoAvailable,
  LAST_DIRECTION_KEY,
  LOCAL_DRAFT_KEY,
  normalizeWorkbenchDraft,
  PALETTE_COLLAPSED_KEY,
  recordHistorySnapshot,
} from './pipeline_workbench_state.js';
```

Add module state:

```js
let historyState = initialHistoryState(graphs);
let publishedFingerprint = fingerprintPipelines(pipelines);
let viewports = {
  client: { zoom: 1, pan: { x: 56, y: 80 } },
  server: { zoom: 1, pan: { x: 56, y: 80 } },
};
```

- [ ] **Step 4: Add mutation and history wrappers**

Add:

```js
function currentViewport() {
  return { zoom, pan: { ...pan } };
}

function saveViewportForDirection() {
  viewports[currentDirection] = currentViewport();
}

function restoreViewportForDirection() {
  const viewport = viewports[currentDirection];
  zoom = viewport?.zoom ?? 1;
  pan = viewport?.pan ? { ...viewport.pan } : { x: 56, y: 80 };
}

function recordGraphMutation() {
  historyState = recordHistorySnapshot(historyState, graphs);
  updateUndoRedoButtons();
}

function replaceGraphsFromHistory(nextGraphs) {
  graphs = nextGraphs;
  syncPipelinesFromGraphs();
  selectedNodeIds.clear();
  executionNodeIds.clear();
  render();
}

function updateUndoRedoButtons() {
  const undo = document.getElementById('btn-undo-pipeline');
  const redo = document.getElementById('btn-redo-pipeline');
  if (undo) undo.disabled = !isUndoAvailable(historyState);
  if (redo) redo.disabled = !isRedoAvailable(historyState);
}
```

Call `recordGraphMutation()` before graph-changing operations: `addPolicyNode`, `deleteSelectedNodes`, `replaceEdge` success path, `removeEdge`, `addMatchCase`, `removeMatchCase`, and node drag pointerup when any position changed.

- [ ] **Step 5: Wire Undo/Redo buttons and keyboard shortcuts**

Add:

```js
function undoGraphChange() {
  historyState = applyHistoryChange(historyState, 'undo');
  replaceGraphsFromHistory(historyState.present);
}

function redoGraphChange() {
  historyState = applyHistoryChange(historyState, 'redo');
  replaceGraphsFromHistory(historyState.present);
}
```

In `bindControls()`:

```js
document.getElementById('btn-undo-pipeline')?.addEventListener('click', undoGraphChange, { signal });
document.getElementById('btn-redo-pipeline')?.addEventListener('click', redoGraphChange, { signal });
```

In the keydown listener:

```js
if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
  event.preventDefault();
  undoGraphChange();
  return;
}
if (
  ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') ||
  ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z')
) {
  event.preventDefault();
  redoGraphChange();
  return;
}
```

- [ ] **Step 6: Wire palette collapse**

Add:

```js
function setPaletteCollapsed(collapsed) {
  document.getElementById('pipeline-workbench')?.classList.toggle('palette-collapsed', collapsed);
  try {
    localStorage.setItem(PALETTE_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Ignore storage failures.
  }
}

function loadPaletteCollapsed() {
  try {
    return localStorage.getItem(PALETTE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
```

In `bindControls()`:

```js
document.getElementById('btn-toggle-palette')?.addEventListener('click', () => {
  const collapsed = !document.getElementById('pipeline-workbench')?.classList.contains('palette-collapsed');
  setPaletteCollapsed(collapsed);
}, { signal });
```

In `initPipelinesPage()` after `render()`:

```js
setPaletteCollapsed(loadPaletteCollapsed());
```

For direction persistence, in tab click:

```js
try {
  localStorage.setItem(LAST_DIRECTION_KEY, currentDirection);
} catch {
  // Ignore storage failures.
}
```

- [ ] **Step 7: Implement Save DAG and draft load**

Add API helpers:

```js
async function fetchPipelineDraft() {
  const res = await fetch('/admin/api/pipeline-draft', { credentials: 'same-origin' });
  if (!res.ok) return { draft: null };
  return res.json();
}

async function savePipelineDraftToServer(draft) {
  const res = await fetch('/admin/api/pipeline-draft', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Draft save failed');
  }
  return res.json();
}

function savePipelineDraftToLocal(draft) {
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
}

function readLocalPipelineDraft() {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
```

Add:

```js
async function saveDag() {
  saveViewportForDirection();
  const draft = buildPipelineDraft({
    graphs,
    viewports,
    publishedFingerprint,
  });
  try {
    savePipelineDraftToLocal(draft);
    await savePipelineDraftToServer(draft);
    setStatus('DAG saved');
  } catch (e) {
    setStatus('DAG saved locally; server draft failed: ' + e.message, true);
  }
}
```

In `bindControls()`:

```js
document.getElementById('btn-save-dag')?.addEventListener('click', saveDag, { signal });
```

In `loadPipelinesPage()`, after `publishedFingerprint` is calculated from config, pick the newest compatible draft:

```js
const serializedFromConfig = {
  client: cloneValue(configData.pipelines?.client ?? []),
  server: cloneValue(configData.pipelines?.server ?? []),
};
publishedFingerprint = fingerprintPipelines(serializedFromConfig);
const [serverDraft, localDraft] = await Promise.all([
  fetchPipelineDraft().then((data) => data.draft).catch(() => null),
  Promise.resolve(readLocalPipelineDraft()),
]);
const candidates = [serverDraft, localDraft]
  .map((draft) => normalizeWorkbenchDraft(draft))
  .filter((result) => !('error' in result))
  .map((result) => result.draft)
  .filter((draft) => draft.lastPublishedFingerprint === publishedFingerprint)
  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
if (candidates[0]) {
  graphs = cloneValue(candidates[0].graphs);
  viewports = cloneValue(candidates[0].viewports ?? viewports);
  pipelines.client = serializedFromConfig.client;
  pipelines.server = serializedFromConfig.server;
} else {
  pipelines.client = serializedFromConfig.client;
  pipelines.server = serializedFromConfig.server;
  graphs = pipelinesToGraph(pipelines);
}
historyState = initialHistoryState(graphs);
```

- [ ] **Step 8: Rename apply to Publish**

Rename `applyConfig()` to `publishConfig()` and update button IDs/text:

```js
async function publishConfig() {
  const btn = document.getElementById('btn-publish-pipeline');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Publishing...';
  }

  const serialized = serializeCurrentPipelines();
  const clientValidation = validatePipelineGraph(graphs.client);
  const serverValidation = validatePipelineGraph(graphs.server);
  const errors = [
    ...clientValidation.errors.map((error) => 'client: ' + error.message),
    ...serverValidation.errors.map((error) => 'server: ' + error.message),
  ];
  if (errors.length > 0) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Publish';
    }
    throw new Error('Fix pipeline wiring before publishing: ' + errors[0]);
  }

  const res = await fetch('/admin/api/pipelines', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelines: serialized }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Publish';
    }
    throw new Error(err.error || 'Publish failed');
  }
  const data = await res.json().catch(() => ({}));
  pipelines.client = cloneValue(data.pipelines?.client ?? serialized.client);
  pipelines.server = cloneValue(data.pipelines?.server ?? serialized.server);
  publishedFingerprint = fingerprintPipelines(serialized);
  await saveDag();
  setStatus('Pipeline published at ' + new Date().toLocaleTimeString());
  if (btn) btn.textContent = 'Publish';
}
```

In `bindControls()`:

```js
document.getElementById('btn-publish-pipeline')?.addEventListener('click', publishConfig, { signal });
```

Remove references to `btn-apply-pipeline`.

- [ ] **Step 9: Run targeted tests**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
deno lint admin/static/pipelines.js admin/static/pipeline_workbench_state.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add admin/static/pipelines.js src/admin/pipelines-static.test.ts
git commit -m "Add pipeline DAG save and undo redo"
```

---

### Task 7: Browser Verification and Interaction Fixes

**Files:**

- Modify: `admin/static/pipelines.js` only if browser verification exposes issues.
- Modify: `admin/static/styles.css` only if browser verification exposes layout issues.

- [ ] **Step 1: Start local admin server**

Use a temporary config file with admin enabled. Example path: `/tmp/pfortner-ui-debug.yaml`.

Run:

```bash
deno run --unstable-net --allow-env --allow-net --allow-read --allow-write=/tmp/pfortner-ui-debug.yaml,/tmp/pfortner-ui-debug.yaml.workbench.json scripts/serve.ts /tmp/pfortner-ui-debug.yaml
```

Expected: server starts and prints the configured port.

- [ ] **Step 2: Run browser smoke script**

Create `/tmp/pfortner-canvas-modal-check.ts` outside the repo with this script:

```ts
import { chromium } from 'npm:playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  extraHTTPHeaders: { Authorization: 'Bearer debug-token' },
});
const page = await context.newPage();
const messages: string[] = [];
page.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => messages.push(`pageerror: ${err.message}`));

await page.goto('http://localhost:60911/admin/pipelines', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

await page.locator('#btn-toggle-palette').click();
const collapsed = await page.locator('#pipeline-workbench.palette-collapsed').count();
if (collapsed !== 1) throw new Error('palette did not collapse');

const settingsAction = page.locator('g.pipeline-node[data-node-id="client-node-1"] [data-action="settings"]').first();
await settingsAction.click();
if (await page.locator('#node-settings-modal.hidden').count() !== 0) throw new Error('settings modal did not open');
await page.locator('#node-settings-modal button', { hasText: 'JSON' }).click();
await page.locator('#node-settings-modal textarea#node-config-editor').fill('{"require_auth":false}');
await page.locator('#node-settings-modal button', { hasText: 'Apply' }).click();
if (await page.locator('#node-settings-modal.hidden').count() !== 1) throw new Error('settings modal did not close');

await page.locator('g.pipeline-node[data-node-id="client-start"] [data-action="run"]').click();
if (await page.locator('#playground-modal.hidden').count() !== 0) throw new Error('playground modal did not open');

await page.locator('#playground-modal button', { hasText: '×' }).click();
await page.locator('#btn-save-dag').click();
await page.waitForTimeout(300);

if (messages.length > 0) throw new Error(messages.join('\n'));
await page.screenshot({ path: '/tmp/pfortner-canvas-modal-check.png', fullPage: false });
await browser.close();
```

Run:

```bash
deno run --allow-net --allow-env --allow-read --allow-sys --allow-write=/tmp --allow-run=/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell /tmp/pfortner-canvas-modal-check.ts
```

Expected: exit 0 and screenshot saved to `/tmp/pfortner-canvas-modal-check.png`.

- [ ] **Step 3: Apply any browser-verification failure patch**

If the script fails, patch only the failed behavior reported by the script. The expected patch targets are `admin/static/pipelines.js` for event/state bugs or `admin/static/styles.css` for hidden/overlapping controls. Re-run the script until it exits 0.

- [ ] **Step 4: Stop local server**

Stop the `scripts/serve.ts` session with Ctrl-C. Confirm no required long-running exec session remains.

- [ ] **Step 5: Commit browser fixes if any**

If Step 3 changed files, run:

```bash
git add admin/static/pipelines.js admin/static/styles.css
git commit -m "Fix pipeline modal browser interactions"
```

If no files changed, do not create an empty commit.

---

### Task 8: Full Verification

**Files:**

- No planned code changes.

- [ ] **Step 1: Run focused static/admin tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/api_routes.test.ts admin/static/page_templates.test.ts src/admin/pipelines-static.test.ts src/config/serve-permissions.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full admin/src test suite**

Run:

```bash
deno test --quiet --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/ src/
```

Expected: `0 failed`.

- [ ] **Step 3: Run formatting checks**

Run:

```bash
deno fmt --check --single-quote=true --line-width=120 --prose-wrap=preserve admin/static/pipeline_workbench_state.js admin/static/pipeline_config_editor.js admin/static/pipelines.js admin/static/page_templates.js admin/routes/pipelines.tsx admin/static/styles.css admin/api_routes.ts admin/api_routes.test.ts src/admin/pipeline_draft.ts src/admin/state.ts scripts/serve.ts src/config/serve-permissions.test.ts src/admin/pipelines-static.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run lint on new/changed runtime JS**

Run:

```bash
deno lint admin/static/pipeline_workbench_state.js admin/static/pipeline_config_editor.js admin/static/pipelines.js
```

Expected: PASS.

- [ ] **Step 5: Check staged/unstaged diff**

Run:

```bash
git status --short
git diff --check
```

Expected: no unstaged files except intentionally ignored `.superpowers/`, and `git diff --check` exits 0.

- [ ] **Step 6: Final implementation commit if verification-only fixes were needed**

If verification required small follow-up fixes, commit them:

```bash
git add admin/static/pipelines.js admin/static/styles.css admin/static/page_templates.js admin/routes/pipelines.tsx admin/api_routes.ts admin/api_routes.test.ts src/admin/pipelines-static.test.ts
git commit -m "Polish pipeline canvas modal refinement"
```

If no files changed, skip this step.

---

## Self-Review Notes

- Spec coverage: canvas-first layout is Task 4; node action/settings modal/playground modal is Task 5; Save DAG/Publish/Undo/Redo is Task 6; server draft API and write permission is Task 3; browser checks are Task 7.
- Runtime model remains `pipelines.client` / `pipelines.server`; no task changes runtime pipeline execution into arbitrary DAG.
- Palette collapsed state is localStorage preference only; DAG draft stores graph positions and viewports.
- Publish uses existing `/admin/api/pipelines`; draft save uses new `/admin/api/pipeline-draft`.
