# Pipeline Workbench Island Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/pipelines` の full workbench を Fresh island component 群へ rewrite し、`admin/static/pipelines.js` への依存を削除する。

**Architecture:** 先に Fresh island bootstrap を hard gate として通し、その後 `PipelineWorkbench` island を reducer state、componentized SVG canvas、modal、API client に分割する。既存の `pipeline_graph.js`、`pipeline_config_editor.js`、`pipeline_workbench_state.js` は pure helper として再利用し、巨大な imperative DOM controller だけを置き換える。

**Tech Stack:** Deno, Fresh 2.x programmatic `App`, `@fresh/core/internal` `ProdBuildCache` / `IslandPreparer` / `setBuildCache`, Preact, SVG, existing admin JSON APIs, localStorage, Playwright QA.

---

## Scope Gate

この計画の Task 1 は実装 gate である。Task 1 が browser QA まで通らない場合、`admin/static/pipelines.js` の削除や editor rewrite には進まない。

Task 1 の目的は、現在の programmatic admin sub-app で Fresh island bootstrap が成立することを確認すること。ここが通れば以降は A案の rewrite を進める。通らない場合は、spec の Open Risk 通り設計見直しに戻る。

## File Structure

- Create `admin/fresh_islands.ts`: Fresh build cache adapter。admin island registry、client entry、static chunk manifest を `App` に install する。
- Create `admin/islands/AdminIslandSmoke.tsx`: bootstrap gate 専用の最小 island。
- Create `admin/islands/PipelineWorkbench.tsx`: workbench island composition root。
- Create `admin/islands/pipeline/types.ts`: workbench graph、viewport、selection、modal、status、API DTO types。
- Create `admin/islands/pipeline/api_client.ts`: `/admin/api/*` fetch wrapper と error normalization。
- Create `admin/islands/pipeline/defaults.ts`: default plugin list、preset messages、storage keys。
- Create `admin/islands/pipeline/yaml_preview.ts`: `buildYamlPreview()` と publish confirmation helper。旧 `pipelines.js` から移す。
- Create `admin/islands/pipeline/node_defaults.ts`: `defaultConfigForPolicy()`、node action helpers、port helpers。旧 `pipelines.js` から移す。
- Create `admin/islands/pipeline/workbench_reducer.ts`: reducer、actions、derived state、history bridge。
- Create `admin/islands/pipeline/Toolbar.tsx`: direction、Undo、Redo、Run、Load、Save、Publish、Fit、zoom controls。
- Create `admin/islands/pipeline/Palette.tsx`: expanded/collapsed policy palette と rail。
- Create `admin/islands/pipeline/Canvas.tsx`: SVG graph rendering、node、edge、ports、wire preview、selection marquee。
- Create `admin/islands/pipeline/NodeSettingsModal.tsx`: `Interactive` / `JSON` config editing。
- Create `admin/islands/pipeline/PlaygroundModal.tsx`: fullscreen playground test run UI。
- Create `admin/islands/pipeline/PublishModal.tsx`: YAML preview、validation summary、confirmation。
- Modify `deno.json`: `@fresh/core/internal` import alias を追加する。必要なら `admin:islands:build` task を追加する。
- Modify `admin/main.ts`: `installAdminIslandBuildCache(app)` を Fresh app assembly の直後に呼ぶ。
- Modify `admin/main.test.ts`: bootstrap gate、PipelineWorkbench island marker、legacy script absence を固定する。
- Modify `admin/routes/pipelines.tsx`: SSR shell と `PipelineWorkbench` island mount に置き換える。
- Modify `admin/static/fresh_nav.js`: `pipelines.js` initializer mapping を削除し、Fresh partial navigation と island boot が共存するようにする。
- Modify `admin/static/styles.css`: island component markup に合わせて canvas-first layout、modal、toolbar、palette、mobile rules を整理する。
- Modify `src/admin/pipelines-static.test.ts`: 旧 `pipelines.js` helper import を island/pure module import に移す。
- Modify `docs/current-architecture.md`: Pipeline Workbench island architecture を現在構造として記載する。
- Delete `admin/static/pipelines.js`: browser QA 通過後に削除する。

## Task 1: Fresh Island Bootstrap Gate

**Files:**

- Create: `admin/fresh_islands.ts`
- Create: `admin/islands/AdminIslandSmoke.tsx`
- Modify: `deno.json`
- Modify: `admin/main.ts`
- Modify: `admin/main.test.ts`
- Modify: `admin/static/fresh_nav.js`

- [ ] **Step 1: `@fresh/core/internal` alias を追加する**

`deno.json` の `imports` に追加する。

```json
"@fresh/core/internal": "jsr:@fresh/core@^2.2.0/internal"
```

- [ ] **Step 2: bootstrap gate test を先に書く**

`admin/main.test.ts` の import はそのまま使い、既存の `admin app page routes render Fresh SSR pages with partial navigation` test の後に追加する。

```ts
Deno.test('admin app installs Fresh island build cache for admin islands', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/pipelines', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  const removedEmptyFreshBootImport = 'import { boot } from ' + '"";';

  assertEquals(html.includes(removedEmptyFreshBootImport), false);
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('frsh:island'), true);
  assertEquals(html.includes('AdminIslandSmoke'), true);
});
```

- [ ] **Step 3: RED を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts
```

Expected: FAIL。`frsh:island` または `AdminIslandSmoke` が HTML に含まれない。

- [ ] **Step 4: smoke island を作る**

`admin/islands/AdminIslandSmoke.tsx` を作成する。

```tsx
/** @jsxImportSource preact */
import { useState } from 'preact/hooks';

export default function AdminIslandSmoke() {
  const [count, setCount] = useState(0);
  return (
    <button
      type='button'
      class='btn btn-ghost'
      data-admin-island-smoke='true'
      onClick={() => setCount((value) => value + 1)}
    >
      Island smoke {count}
    </button>
  );
}
```

- [ ] **Step 5: admin build cache adapter を作る**

`admin/fresh_islands.ts` を作成する。`clientEntry` は既存の `/admin/static/fresh_nav.js` を使う。`fresh_nav.js` は partial navigation runtime として残し、Fresh の `boot(islands, props)` 呼び出しも受けられるようにする。

```ts
import type { App } from '@fresh/core';
import { IslandPreparer, ProdBuildCache, setBuildCache } from '@fresh/core/internal';
import * as AdminIslandSmokeModule from './islands/AdminIslandSmoke.tsx';

type AdminIslandModule = Record<string, unknown>;

interface AdminIslandSpec {
  module: AdminIslandModule;
  chunk: string;
  name: string;
}

const ADMIN_ISLAND_VERSION = 'admin-islands-v1';
const ADMIN_CLIENT_ENTRY = '/admin/static/fresh_nav.js';

const ADMIN_ISLANDS: AdminIslandSpec[] = [
  {
    module: AdminIslandSmokeModule,
    chunk: '/admin/static/islands/AdminIslandSmoke.js',
    name: 'AdminIslandSmoke',
  },
];

export function installAdminIslandBuildCache(app: App<unknown>): void {
  const islands = new Map();
  const preparer = new IslandPreparer();
  for (const spec of ADMIN_ISLANDS) {
    preparer.prepare(islands, spec.module, spec.chunk, spec.name, []);
  }

  const cache = new ProdBuildCache('.', {
    version: ADMIN_ISLAND_VERSION,
    clientEntry: ADMIN_CLIENT_ENTRY,
    fsRoutes: [],
    staticFiles: new Map(),
    islands,
    entryAssets: [],
  });

  setBuildCache(app, cache, 'production');
}
```

- [ ] **Step 6: app assembly に build cache を install する**

`admin/main.ts` に import を追加する。

```ts
import { installAdminIslandBuildCache } from './fresh_islands.ts';
```

既存の `const app = new App({ root: STATIC_DIR })` 初期化直後に追加する。

```ts
installAdminIslandBuildCache(app as App<unknown>);
```

- [ ] **Step 7: `PipelinesPage` に smoke island を一時 mount する**

`admin/routes/pipelines.tsx` に import を追加する。

```tsx
import AdminIslandSmoke from '../islands/AdminIslandSmoke.tsx';
```

`page-header` 内の toolbar の後に一時的に置く。

```tsx
<AdminIslandSmoke />;
```

- [ ] **Step 8: `fresh_nav.js` の `boot()` を island boot 互換にする**

`admin/static/fresh_nav.js` の `export function boot()` を、引数を受け取れる signature に変更する。

```js
export function boot(islands = {}, props = []) {
  installNavigation();
  if (islands && Object.keys(islands).length > 0) {
    globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__ = { islands, props };
  }
}
```

この step では hydration 実装はまだ入れない。HTML marker と inline boot args の存在を固定する gate である。

- [ ] **Step 9: targeted test を通す**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts
```

Expected: PASS。特に `admin app installs Fresh island build cache for admin islands` が通る。

- [ ] **Step 10: browser QA で bootstrap args を確認する**

一時 config を使って admin を起動する。

```bash
deno run --unstable-net --allow-env --allow-net --allow-read --allow-write=/tmp/pfortner-fresh-admin.yaml,/tmp/pfortner-fresh-admin.yaml.workbench.json scripts/serve.ts /tmp/pfortner-fresh-admin.yaml
```

Playwright で `/admin/pipelines` を開き、以下を確認する。

```ts
const args = await page.evaluate(() => globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__ ?? null);
expect(args).not.toBeNull();
expect(Object.keys(args.islands)).toContain('AdminIslandSmoke');
```

Expected: browser console error がなく、`args` が存在する。

- [ ] **Step 11: Gate commit**

```bash
git add deno.json admin/fresh_islands.ts admin/islands/AdminIslandSmoke.tsx admin/main.ts admin/main.test.ts admin/routes/pipelines.tsx admin/static/fresh_nav.js
git commit -m "Add admin Fresh island bootstrap gate"
```

## Task 2: Island Client Hydration Adapter

**Files:**

- Modify: `admin/static/fresh_nav.js`
- Create: `admin/static/islands/AdminIslandSmoke.js`
- Modify: `admin/main.test.ts`

- [ ] **Step 1: hydration marker test を追加する**

`admin/main.test.ts` の bootstrap gate test に次の assertions を追加する。

```ts
assertEquals(html.includes('/admin/static/islands/AdminIslandSmoke.js'), true);
assertEquals(html.includes('data-admin-island-smoke'), true);
```

- [ ] **Step 2: static smoke island chunk を作る**

`admin/static/islands/AdminIslandSmoke.js` を作成する。

```js
export default function AdminIslandSmoke() {
  return null;
}

AdminIslandSmoke.mount = function mountAdminIslandSmoke(root) {
  const button = root.querySelector('[data-admin-island-smoke="true"]');
  if (!button || button.dataset.mounted === 'true') return;
  button.dataset.mounted = 'true';
  button.addEventListener('click', () => {
    const current = Number(button.dataset.count || '0') + 1;
    button.dataset.count = String(current);
    button.textContent = `Island smoke ${current}`;
  });
};
```

- [ ] **Step 3: `fresh_nav.js` に local island mount bridge を入れる**

`boot()` の island branch を次の形にする。

```js
function mountAdminIslands(islands) {
  for (const island of Object.values(islands ?? {})) {
    if (typeof island?.mount !== 'function') continue;
    island.mount(document);
  }
}

export function boot(islands = {}, props = []) {
  installNavigation();
  globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__ = { islands, props };
  mountAdminIslands(islands);
}
```

- [ ] **Step 4: tests を通す**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts
```

Expected: PASS。

- [ ] **Step 5: browser QA で smoke click を確認する**

Playwright assertion:

```ts
await page.locator('[data-admin-island-smoke="true"]').click();
await expect(page.locator('[data-admin-island-smoke="true"]')).toContainText('Island smoke 1');
```

Expected: PASS。`pageErrors` と `consoleMessages` は空。

- [ ] **Step 6: Commit**

```bash
git add admin/static/fresh_nav.js admin/static/islands/AdminIslandSmoke.js admin/main.test.ts
git commit -m "Hydrate admin island bootstrap smoke test"
```

## Task 3: Move Pure Pipeline Helpers Out of `pipelines.js`

**Files:**

- Create: `admin/islands/pipeline/yaml_preview.ts`
- Create: `admin/islands/pipeline/node_defaults.ts`
- Modify: `src/admin/pipelines-static.test.ts`
- Modify: `admin/static/pipelines.js`

- [ ] **Step 1: tests を新 import に切り替えて RED を作る**

`src/admin/pipelines-static.test.ts` の旧 import:

```ts
import {
  addMatchCaseDraftConfig,
  buildYamlPreview,
  defaultConfigForPolicy,
  reconcileMatchCaseEdges,
  removeMatchCaseDraftConfig,
} from '../../admin/static/pipelines.js';
```

を次に変更する。

```ts
import { buildPublishConfirmationMessage, buildYamlPreview } from '../../admin/islands/pipeline/yaml_preview.ts';
import {
  addMatchCaseDraftConfig,
  defaultConfigForPolicy,
  isMovablePipelineNode,
  reconcileMatchCaseEdges,
  removeMatchCaseDraftConfig,
  shouldRenderInputPort,
} from '../../admin/islands/pipeline/node_defaults.ts';
```

- [ ] **Step 2: RED を確認する**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: FAIL。`admin/islands/pipeline/yaml_preview.ts` が存在しない。

- [ ] **Step 3: YAML helper を移す**

`admin/islands/pipeline/yaml_preview.ts` を作成し、旧 `pipelines.js` の `toYamlValue()`、`entriesToYaml()`、`buildYamlPreview()`、`buildPublishConfirmationMessage()` を移す。

```ts
export function buildYamlPreview(pipes: { client?: unknown[]; server?: unknown[] }): string {
  let yaml = 'pipelines:\n';
  yaml += '  client:\n';
  yaml += entriesToYaml(Array.isArray(pipes.client) ? pipes.client : [], 4);
  yaml += '  server:\n';
  yaml += entriesToYaml(Array.isArray(pipes.server) ? pipes.server : [], 4);
  return yaml;
}

export function buildPublishConfirmationMessage(yaml: string): string {
  return 'Publish this pipeline configuration to the active config file?\n\n' + yaml;
}
```

移植時は既存 test が期待する empty arrays、nested object、array formatting を崩さない。

- [ ] **Step 4: node default helper を移す**

`admin/islands/pipeline/node_defaults.ts` を作成し、旧 `pipelines.js` から以下を移す。

```ts
export function defaultConfigForPolicy(name: string): Record<string, unknown> {
  // 旧 pipelines.js の policy default map と同じ値を返す。
}

export function shouldRenderInputPort(node: { type?: string; policy?: string } | null | undefined): boolean {
  return !isStartNode(node);
}

export function isMovablePipelineNode(node: unknown): boolean {
  return Boolean(node);
}
```

`addMatchCaseDraftConfig()`、`removeMatchCaseDraftConfig()`、`reconcileMatchCaseEdges()` も同じ file に移す。

- [ ] **Step 5: `pipelines.js` を互換 import にする**

一時的に旧 `admin/static/pipelines.js` は helper を re-export する。

```js
export { buildPublishConfirmationMessage, buildYamlPreview } from '../islands/pipeline/yaml_preview.ts';
export {
  addMatchCaseDraftConfig,
  defaultConfigForPolicy,
  isMovablePipelineNode,
  reconcileMatchCaseEdges,
  removeMatchCaseDraftConfig,
  shouldRenderInputPort,
} from '../islands/pipeline/node_defaults.ts';
```

この relative path が browser で使われる前に旧 `pipelines.js` は削除されるため、ここでは test migration の一時 bridge として扱う。

- [ ] **Step 6: tests を通す**

Run:

```bash
deno test --allow-read src/admin/pipelines-static.test.ts
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add admin/islands/pipeline/yaml_preview.ts admin/islands/pipeline/node_defaults.ts admin/static/pipelines.js src/admin/pipelines-static.test.ts
git commit -m "Extract pipeline workbench pure helpers"
```

## Task 4: Workbench Types, API Client, and Reducer

**Files:**

- Create: `admin/islands/pipeline/types.ts`
- Create: `admin/islands/pipeline/defaults.ts`
- Create: `admin/islands/pipeline/api_client.ts`
- Create: `admin/islands/pipeline/workbench_reducer.ts`
- Create: `admin/islands/pipeline/workbench_reducer.test.ts`

- [ ] **Step 1: reducer tests を書く**

`admin/islands/pipeline/workbench_reducer.test.ts` を作成する。

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { pipelinesToGraph } from '../../../static/pipeline_graph.js';
import { createInitialWorkbenchState, reduceWorkbench } from './workbench_reducer.ts';

Deno.test('workbench reducer switches direction and preserves viewport', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  let state = createInitialWorkbenchState({ graphs, plugins: ['accept'], publishedFingerprint: 'fp' });

  state = reduceWorkbench(state, { type: 'viewportChanged', zoom: 1.4, pan: { x: 20, y: 30 } });
  state = reduceWorkbench(state, { type: 'directionChanged', direction: 'server' });

  assertEquals(state.direction, 'server');
  assertEquals(state.viewports.client.zoom, 1.4);
  assertEquals(state.viewports.client.pan, { x: 20, y: 30 });
});

Deno.test('workbench reducer records node move as undoable action', () => {
  const graphs = pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] });
  let state = createInitialWorkbenchState({ graphs, plugins: ['accept'], publishedFingerprint: 'fp' });
  const node = state.graphs.client.nodes.find((item: any) => item.policy === 'accept')!;

  state = reduceWorkbench(state, { type: 'nodeMoved', nodeId: node.id, x: 160, y: 96 });
  state = reduceWorkbench(state, { type: 'undo' });

  const reverted = state.graphs.client.nodes.find((item: any) => item.id === node.id)!;
  assertEquals(reverted.x === 160, false);
});
```

- [ ] **Step 2: RED を確認する**

Run:

```bash
deno test --allow-read admin/islands/pipeline/workbench_reducer.test.ts
```

Expected: FAIL。`workbench_reducer.ts` がない。

- [ ] **Step 3: types を定義する**

`admin/islands/pipeline/types.ts` を作成する。

```ts
export type PipelineDirection = 'client' | 'server';
export interface Point {
  x: number;
  y: number;
}
export interface Viewport {
  zoom: number;
  pan: Point;
}
export interface DirectionViewports {
  client: Viewport;
  server: Viewport;
}
export interface PipelineGraph {
  direction?: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}
export interface PipelineGraphs {
  client: PipelineGraph;
  server: PipelineGraph;
}
export interface PipelineNode {
  id: string;
  type?: string;
  policy?: string;
  config?: unknown;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
export interface PipelineEdge {
  id: string;
  from: string;
  fromPort?: string;
  to: string;
}
export interface WorkbenchStatus {
  message: string;
  kind: 'idle' | 'info' | 'warning' | 'error' | 'success';
}
export type ActiveModal =
  | { type: 'none' }
  | { type: 'settings'; nodeId: string; mode: 'interactive' | 'json'; json: string; error: string }
  | { type: 'playground'; nodeId: string | null }
  | { type: 'publish'; yaml: string };
```

- [ ] **Step 4: defaults と API client を作る**

`admin/islands/pipeline/defaults.ts`:

```ts
export const DEFAULT_PLUGINS = [
  'accept',
  'kind-filter',
  'write-guard',
  'protected-event',
  'rate-limit',
  'spam-filter',
  'content-filter',
  'pubkey-acl',
  'ip-filter',
  'when',
  'match',
  'route',
];
```

`admin/islands/pipeline/api_client.ts`:

```ts
async function readJson(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function fetchAdminConfig(): Promise<any> {
  return await readJson(await fetch('/admin/api/config', { credentials: 'same-origin' }));
}

export async function fetchAdminPlugins(): Promise<{ plugins: string[] }> {
  return await readJson(await fetch('/admin/api/plugins', { credentials: 'same-origin' }));
}

export async function fetchPipelineDraft(): Promise<any | null> {
  const data = await readJson(await fetch('/admin/api/pipeline-draft', { credentials: 'same-origin' }));
  return data.draft ?? null;
}

export async function savePipelineDraft(draft: unknown): Promise<any> {
  return await readJson(
    await fetch('/admin/api/pipeline-draft', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft }),
    }),
  );
}

export async function publishPipelines(pipelines: unknown): Promise<any> {
  return await readJson(
    await fetch('/admin/api/pipelines', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelines }),
    }),
  );
}
```

- [ ] **Step 5: reducer を実装する**

`admin/islands/pipeline/workbench_reducer.ts` を作成する。

```ts
import {
  applyHistoryChange,
  initialDirectionHistoryState,
  recordDirectionHistorySnapshot,
} from '../../../static/pipeline_workbench_state.js';
import type { DirectionViewports, PipelineDirection, PipelineGraphs, WorkbenchStatus } from './types.ts';

export interface WorkbenchState {
  direction: PipelineDirection;
  graphs: PipelineGraphs;
  history: ReturnType<typeof initialDirectionHistoryState>;
  viewports: DirectionViewports;
  selectedNodeIds: string[];
  plugins: string[];
  publishedFingerprint: string;
  status: WorkbenchStatus;
}

export type WorkbenchAction =
  | { type: 'directionChanged'; direction: PipelineDirection }
  | { type: 'viewportChanged'; zoom: number; pan: { x: number; y: number } }
  | { type: 'nodeMoved'; nodeId: string; x: number; y: number }
  | { type: 'undo' }
  | { type: 'redo' };

export function createInitialWorkbenchState(input: {
  graphs: PipelineGraphs;
  plugins: string[];
  publishedFingerprint: string;
}): WorkbenchState {
  return {
    direction: 'client',
    graphs: structuredClone(input.graphs),
    history: initialDirectionHistoryState(input.graphs),
    viewports: {
      client: { zoom: 1, pan: { x: 56, y: 80 } },
      server: { zoom: 1, pan: { x: 56, y: 80 } },
    },
    selectedNodeIds: [],
    plugins: input.plugins,
    publishedFingerprint: input.publishedFingerprint,
    status: { message: 'Ready', kind: 'idle' },
  };
}

export function reduceWorkbench(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  if (action.type === 'directionChanged') {
    return { ...state, direction: action.direction };
  }
  if (action.type === 'viewportChanged') {
    return {
      ...state,
      viewports: {
        ...state.viewports,
        [state.direction]: { zoom: action.zoom, pan: action.pan },
      },
    };
  }
  if (action.type === 'nodeMoved') {
    const graph = structuredClone(state.graphs[state.direction]);
    const node = graph.nodes.find((item) => item.id === action.nodeId);
    if (!node) return state;
    node.x = action.x;
    node.y = action.y;
    const graphs = { ...state.graphs, [state.direction]: graph };
    return {
      ...state,
      graphs,
      history: recordDirectionHistorySnapshot(state.history, state.direction, graph),
    };
  }
  if (action.type === 'undo' || action.type === 'redo') {
    const history = {
      ...state.history,
      [state.direction]: applyHistoryChange(state.history[state.direction], action.type),
    };
    return {
      ...state,
      history,
      graphs: { ...state.graphs, [state.direction]: history[state.direction].present },
    };
  }
  return state;
}
```

- [ ] **Step 6: reducer tests を通す**

Run:

```bash
deno test --allow-read admin/islands/pipeline/workbench_reducer.test.ts
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add admin/islands/pipeline/types.ts admin/islands/pipeline/defaults.ts admin/islands/pipeline/api_client.ts admin/islands/pipeline/workbench_reducer.ts admin/islands/pipeline/workbench_reducer.test.ts
git commit -m "Add pipeline workbench island state core"
```

## Task 5: PipelineWorkbench Island Shell

**Files:**

- Create: `admin/islands/PipelineWorkbench.tsx`
- Create: `admin/islands/pipeline/Toolbar.tsx`
- Create: `admin/islands/pipeline/Palette.tsx`
- Modify: `admin/fresh_islands.ts`
- Modify: `admin/routes/pipelines.tsx`
- Modify: `admin/main.test.ts`

- [ ] **Step 1: route test を island shell 期待に変更する**

`admin/main.test.ts` の page route test に追加する。

```ts
assertEquals(html.includes('PipelineWorkbench'), true);
assertEquals(html.includes('/admin/static/pipelines.js'), false);
```

- [ ] **Step 2: `Toolbar.tsx` を作る**

```tsx
/** @jsxImportSource preact */
import type { PipelineDirection } from './types.ts';

export function Toolbar(props: {
  direction: PipelineDirection;
  onDirectionChange(direction: PipelineDirection): void;
  onRun(): void;
  onLoad(): void;
  onSave(): void;
  onPublish(): void;
  onUndo(): void;
  onRedo(): void;
}) {
  return (
    <div class='pipeline-toolbar'>
      <button
        type='button'
        class={props.direction === 'client' ? 'btn btn-primary' : 'btn btn-ghost'}
        onClick={() => props.onDirectionChange('client')}
      >
        Client
      </button>
      <button
        type='button'
        class={props.direction === 'server' ? 'btn btn-primary' : 'btn btn-ghost'}
        onClick={() => props.onDirectionChange('server')}
      >
        Server
      </button>
      <button type='button' class='btn btn-ghost' onClick={props.onUndo}>↶ Undo</button>
      <button type='button' class='btn btn-ghost' onClick={props.onRedo}>↷ Redo</button>
      <button type='button' class='btn btn-ghost' onClick={props.onRun}>▷ Run</button>
      <button type='button' class='btn btn-ghost' onClick={props.onLoad}>Load</button>
      <button type='button' class='btn btn-ghost' onClick={props.onSave}>Save</button>
      <button type='button' class='btn btn-primary' onClick={props.onPublish}>Publish</button>
    </div>
  );
}
```

- [ ] **Step 3: `Palette.tsx` を作る**

```tsx
/** @jsxImportSource preact */

export function Palette(props: {
  plugins: string[];
  collapsed: boolean;
  onToggle(): void;
  onAdd(policy: string): void;
}) {
  return (
    <aside
      class={props.collapsed ? 'workbench-panel palette-panel palette-collapsed' : 'workbench-panel palette-panel'}
    >
      <div class='workbench-panel-header palette-header'>
        <span>Policy Palette</span>
        <button type='button' class='btn btn-ghost btn-icon' onClick={props.onToggle}>
          {props.collapsed ? '›' : '‹'}
        </button>
      </div>
      <div class='workbench-panel-body policy-palette'>
        {props.plugins.map((name) => (
          <button
            type='button'
            class='policy-palette-item'
            onClick={() => props.onAdd(name)}
          >
            <span class='policy-palette-name'>{name}</span>
            <span class='policy-palette-add'>+</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: `PipelineWorkbench.tsx` skeleton を作る**

```tsx
/** @jsxImportSource preact */
import { useReducer } from 'preact/hooks';
import { pipelinesToGraph } from '../static/pipeline_graph.js';
import { fingerprintPipelines } from '../static/pipeline_workbench_state.js';
import { DEFAULT_PLUGINS } from './pipeline/defaults.ts';
import { Palette } from './pipeline/Palette.tsx';
import { Toolbar } from './pipeline/Toolbar.tsx';
import { createInitialWorkbenchState, reduceWorkbench } from './pipeline/workbench_reducer.ts';

export default function PipelineWorkbench() {
  const [state, dispatch] = useReducer(
    reduceWorkbench,
    createInitialWorkbenchState({
      graphs: pipelinesToGraph({ client: [], server: [] }),
      plugins: DEFAULT_PLUGINS,
      publishedFingerprint: fingerprintPipelines({ client: [], server: [] }),
    }),
  );

  return (
    <div class='pipeline-workbench' id='pipeline-workbench'>
      <Toolbar
        direction={state.direction}
        onDirectionChange={(direction) => dispatch({ type: 'directionChanged', direction })}
        onRun={() => {}}
        onLoad={() => {}}
        onSave={() => {}}
        onPublish={() => {}}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
      />
      <div class='workbench-state-badges'>
        <span class='text-muted'>{state.status.message}</span>
      </div>
      <div class='workbench-grid canvas-first-grid'>
        <Palette plugins={state.plugins} collapsed={false} onToggle={() => {}} onAdd={() => {}} />
        <section class='canvas-shell canvas-shell-expanded'>
          <div class='canvas-toolbar'>
            <span>{state.direction === 'client' ? 'Client Pipeline' : 'Server Pipeline'}</span>
            <span class='text-muted'>100%</span>
          </div>
          <div class='pipeline-canvas' tabIndex={0}></div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: island registry に `PipelineWorkbench` を追加する**

`admin/fresh_islands.ts` に import と manifest entry を追加する。

```ts
import * as PipelineWorkbenchModule from './islands/PipelineWorkbench.tsx';

{
  module: PipelineWorkbenchModule,
  chunk: '/admin/static/islands/PipelineWorkbench.js',
  name: 'PipelineWorkbench',
}
```

- [ ] **Step 6: route を shell 化する**

`admin/routes/pipelines.tsx` は `<PipelineWorkbench />` だけを workbench body に置き、旧 toolbar/canvas/modal markup と script tag を外す。

```tsx
<Layout currentPath={currentPath} title='Pipelines'>
  <div class='page-header'>
    <h1 class='page-title'>Pipelines</h1>
  </div>
  <PipelineWorkbench />
</Layout>;
```

- [ ] **Step 7: tests を通す**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/page_routes.test.ts
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/Toolbar.tsx admin/islands/pipeline/Palette.tsx admin/fresh_islands.ts admin/routes/pipelines.tsx admin/main.test.ts
git commit -m "Mount pipeline workbench island shell"
```

## Task 6: Canvas Rendering and Graph Interaction

**Files:**

- Create: `admin/islands/pipeline/Canvas.tsx`
- Modify: `admin/islands/PipelineWorkbench.tsx`
- Modify: `admin/islands/pipeline/workbench_reducer.ts`
- Modify: `admin/islands/pipeline/workbench_reducer.test.ts`
- Modify: `admin/static/styles.css`

- [ ] **Step 1: reducer tests for node add/delete/edge replace を追加する**

`admin/islands/pipeline/workbench_reducer.test.ts` に追加する。

```ts
Deno.test('workbench reducer adds a policy node after start', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  let state = createInitialWorkbenchState({ graphs, plugins: ['accept'], publishedFingerprint: 'fp' });

  state = reduceWorkbench(state, { type: 'policyNodeAdded', policy: 'accept', position: { x: 160, y: 80 } });

  assertEquals(state.graphs.client.nodes.some((node: any) => node.policy === 'accept'), true);
  assertEquals(state.graphs.client.edges.some((edge: any) => edge.from === 'client-start'), true);
});
```

- [ ] **Step 2: reducer action を実装する**

`WorkbenchAction` に追加する。

```ts
| { type: 'policyNodeAdded'; policy: string; position: Point }
| { type: 'nodeDeleted'; nodeId: string }
| { type: 'edgeReplaced'; from: string; fromPort: string; to: string };
```

`policyNodeAdded` は current graph の start node から新 node へ edge を作り、history に積む。

- [ ] **Step 3: `Canvas.tsx` を作る**

```tsx
/** @jsxImportSource preact */
import type { PipelineEdge, PipelineGraph, PipelineNode } from './types.ts';

export function Canvas(props: {
  graph: PipelineGraph;
  selectedNodeIds: string[];
  onNodePointerDown(nodeId: string, event: PointerEvent): void;
  onNodeDoubleClick(nodeId: string): void;
}) {
  return (
    <div class='pipeline-canvas' tabIndex={0}>
      <svg class='pipeline-svg' role='application' aria-label='Pipeline graph editor'>
        <g class='pipeline-edge-layer'>
          {props.graph.edges.map((edge: PipelineEdge) => (
            <path class='pipeline-edge' data-edge-id={edge.id} d={edgePath(props.graph, edge)} />
          ))}
        </g>
        <g class='pipeline-node-layer'>
          {props.graph.nodes.map((node: PipelineNode) => (
            <g
              class={props.selectedNodeIds.includes(node.id) ? 'pipeline-node selected' : 'pipeline-node'}
              transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
              data-node-id={node.id}
              onDblClick={() => props.onNodeDoubleClick(node.id)}
            >
              <rect class='pipeline-node-card' width='180' height='72' rx='8' />
              <text class='pipeline-node-title' x='16' y='28'>{node.policy ?? node.id}</text>
              <text class='pipeline-node-subtitle' x='16' y='50'>{node.id}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function edgePath(graph: PipelineGraph, edge: PipelineEdge): string {
  const from = graph.nodes.find((node) => node.id === edge.from);
  const to = graph.nodes.find((node) => node.id === edge.to);
  if (!from || !to) return '';
  const x1 = (from.x ?? 0) + 180;
  const y1 = (from.y ?? 0) + 36;
  const x2 = to.x ?? 0;
  const y2 = (to.y ?? 0) + 36;
  const mid = x1 + Math.max(40, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}
```

- [ ] **Step 4: Workbench に Canvas を接続する**

`PipelineWorkbench.tsx` に `Canvas` を import し、placeholder canvas を置換する。

```tsx
<Canvas
  graph={state.graphs[state.direction]}
  selectedNodeIds={state.selectedNodeIds}
  onNodePointerDown={() => {}}
  onNodeDoubleClick={(nodeId) => dispatch({ type: 'nodeDoubleClicked', nodeId })}
/>;
```

- [ ] **Step 5: styles を移植する**

`admin/static/styles.css` の既存 `.pipeline-canvas`、`.pipeline-svg`、`.pipeline-node`、`.pipeline-edge` rule を island markup でも使えるように class 名を維持する。nested selector は追加しない。

- [ ] **Step 6: tests を通す**

Run:

```bash
deno test --allow-read admin/islands/pipeline/workbench_reducer.test.ts src/admin/pipelines-static.test.ts
deno check admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/Canvas.tsx
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/Canvas.tsx admin/islands/pipeline/workbench_reducer.ts admin/islands/pipeline/workbench_reducer.test.ts admin/static/styles.css
git commit -m "Render pipeline graph in workbench island"
```

## Task 7: Node Settings, Playground, and Publish Modals

**Files:**

- Create: `admin/islands/pipeline/NodeSettingsModal.tsx`
- Create: `admin/islands/pipeline/PlaygroundModal.tsx`
- Create: `admin/islands/pipeline/PublishModal.tsx`
- Modify: `admin/islands/PipelineWorkbench.tsx`
- Modify: `admin/islands/pipeline/workbench_reducer.ts`
- Modify: `admin/static/styles.css`

- [ ] **Step 1: modal action tests を追加する**

`admin/islands/pipeline/workbench_reducer.test.ts` に追加する。

```ts
Deno.test('workbench reducer opens settings for policy node and playground for start node', () => {
  const graphs = pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] });
  let state = createInitialWorkbenchState({ graphs, plugins: ['accept'], publishedFingerprint: 'fp' });
  const start = state.graphs.client.nodes.find((node: any) => node.policy === 'start')!;
  const policy = state.graphs.client.nodes.find((node: any) => node.policy === 'accept')!;

  state = reduceWorkbench(state, { type: 'nodeDoubleClicked', nodeId: start.id });
  assertEquals(state.ui.activeModal.type, 'playground');

  state = reduceWorkbench(state, { type: 'nodeDoubleClicked', nodeId: policy.id });
  assertEquals(state.ui.activeModal.type, 'settings');
});
```

- [ ] **Step 2: modal state を reducer に追加する**

`WorkbenchState` に追加する。

```ts
ui: {
  activeModal: ActiveModal;
  paletteCollapsed: boolean;
}
```

`nodeDoubleClicked`、`modalClosed`、`settingsJsonChanged`、`settingsApplied` actions を追加する。

- [ ] **Step 3: `NodeSettingsModal.tsx` を作る**

```tsx
/** @jsxImportSource preact */
import type { PipelineNode } from './types.ts';

export function NodeSettingsModal(props: {
  node: PipelineNode;
  mode: 'interactive' | 'json';
  json: string;
  error: string;
  onModeChange(mode: 'interactive' | 'json'): void;
  onJsonChange(value: string): void;
  onApply(): void;
  onClose(): void;
}) {
  return (
    <div class='modal-backdrop'>
      <section class='modal node-settings-panel' role='dialog' aria-modal='true'>
        <header class='modal-header'>
          <h2>{props.node.policy}</h2>
          <button type='button' class='btn btn-ghost btn-icon' onClick={props.onClose}>×</button>
        </header>
        <div class='segmented-control'>
          <button
            type='button'
            class={props.mode === 'interactive' ? 'active' : ''}
            onClick={() => props.onModeChange('interactive')}
          >
            Interactive
          </button>
          <button
            type='button'
            class={props.mode === 'json' ? 'active' : ''}
            onClick={() => props.onModeChange('json')}
          >
            JSON
          </button>
        </div>
        <textarea
          class='code-textarea'
          value={props.json}
          onInput={(event) => props.onJsonChange((event.currentTarget as HTMLTextAreaElement).value)}
        />
        {props.error ? <div class='form-error'>{props.error}</div> : null}
        <footer class='modal-footer'>
          <button type='button' class='btn btn-ghost' onClick={props.onClose}>Cancel</button>
          <button type='button' class='btn btn-primary' onClick={props.onApply}>Apply</button>
        </footer>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: `PlaygroundModal.tsx` と `PublishModal.tsx` を作る**

`PlaygroundModal.tsx` は message textarea、Run、result panel を持つ。`PublishModal.tsx` は YAML preview、Cancel、Publish を持つ。

```tsx
/** @jsxImportSource preact */

export function PublishModal(props: {
  yaml: string;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <div class='modal-backdrop'>
      <section class='modal publish-panel' role='dialog' aria-modal='true'>
        <header class='modal-header'>
          <h2>Publish</h2>
        </header>
        <pre class='yaml-preview'>{props.yaml}</pre>
        <footer class='modal-footer'>
          <button type='button' class='btn btn-ghost' onClick={props.onClose}>Cancel</button>
          <button type='button' class='btn btn-primary' onClick={props.onConfirm}>Publish</button>
        </footer>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Workbench に modals を接続する**

`PipelineWorkbench.tsx` は `state.ui.activeModal` に応じて modal component を出す。

```tsx
{
  state.ui.activeModal.type === 'settings' && selectedNode
    ? (
      <NodeSettingsModal
        node={selectedNode}
        mode={state.ui.activeModal.mode}
        json={state.ui.activeModal.json}
        error={state.ui.activeModal.error}
        onModeChange={(mode) => dispatch({ type: 'settingsModeChanged', mode })}
        onJsonChange={(value) => dispatch({ type: 'settingsJsonChanged', value })}
        onApply={() => dispatch({ type: 'settingsApplied' })}
        onClose={() => dispatch({ type: 'modalClosed' })}
      />
    )
    : null;
}
{
  state.ui.activeModal.type === 'publish'
    ? (
      <PublishModal
        yaml={state.ui.activeModal.yaml}
        onConfirm={() => dispatch({ type: 'publishConfirmed' })}
        onClose={() => dispatch({ type: 'modalClosed' })}
      />
    )
    : null;
}
```

- [ ] **Step 6: tests と check を通す**

Run:

```bash
deno test --allow-read admin/islands/pipeline/workbench_reducer.test.ts
deno check admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/NodeSettingsModal.tsx admin/islands/pipeline/PlaygroundModal.tsx admin/islands/pipeline/PublishModal.tsx
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/NodeSettingsModal.tsx admin/islands/pipeline/PlaygroundModal.tsx admin/islands/pipeline/PublishModal.tsx admin/islands/pipeline/workbench_reducer.ts admin/islands/pipeline/workbench_reducer.test.ts admin/static/styles.css
git commit -m "Add pipeline workbench island modals"
```

## Task 8: Save, Load, Publish, and Playground API Wiring

**Files:**

- Modify: `admin/islands/PipelineWorkbench.tsx`
- Modify: `admin/islands/pipeline/api_client.ts`
- Modify: `admin/islands/pipeline/workbench_reducer.ts`
- Modify: `admin/islands/pipeline/workbench_reducer.test.ts`
- Modify: `src/admin/pipelines-static.test.ts`

- [ ] **Step 1: draft selection tests を reducer に追加する**

```ts
Deno.test('workbench reducer loads saved draft as undoable replace', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  const nextGraphs = pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] });
  let state = createInitialWorkbenchState({ graphs, plugins: ['accept'], publishedFingerprint: 'fp' });

  state = reduceWorkbench(state, { type: 'graphsLoaded', graphs: nextGraphs, message: 'Loaded saved DAG' });
  assertEquals(state.graphs.client.nodes.some((node: any) => node.policy === 'accept'), true);

  state = reduceWorkbench(state, { type: 'undo' });
  assertEquals(state.graphs.client.nodes.some((node: any) => node.policy === 'accept'), false);
});
```

- [ ] **Step 2: async effects を Workbench に追加する**

`PipelineWorkbench.tsx` に初期 load effect を追加する。

```tsx
useEffect(() => {
  let active = true;
  (async () => {
    const [config, plugins, draft] = await Promise.all([
      fetchAdminConfig(),
      fetchAdminPlugins().catch(() => ({ plugins: DEFAULT_PLUGINS })),
      fetchPipelineDraft().catch(() => null),
    ]);
    if (!active) return;
    dispatch({
      type: 'initialDataLoaded',
      pipelines: config.pipelines ?? { client: [], server: [] },
      plugins: plugins.plugins,
      draft,
    });
  })().catch((error) => {
    if (active) dispatch({ type: 'loadFailed', message: error.message });
  });
  return () => {
    active = false;
  };
}, []);
```

- [ ] **Step 3: Save / Load handlers を追加する**

`PipelineWorkbench.tsx` の toolbar callbacks を実装する。

```tsx
async function handleSave() {
  const draft = buildPipelineDraft({
    graphs: state.graphs,
    viewports: state.viewports,
    publishedFingerprint: state.publishedFingerprint,
    now: Date.now(),
  });
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
  try {
    await savePipelineDraft(draft);
    dispatch({ type: 'draftSaved', message: 'DAG saved' });
  } catch (error) {
    dispatch({ type: 'draftSaved', message: `DAG saved locally; server draft failed: ${(error as Error).message}` });
  }
}
```

- [ ] **Step 4: Publish handler を追加する**

`PublishModal` の confirm で `publishPipelines(graphToPipelines(state.graphs))` を呼び、response pipelines で state を同期する。

```tsx
async function handlePublishConfirm() {
  const serialized = graphToPipelines(state.graphs);
  const data = await publishPipelines(serialized);
  dispatch({ type: 'published', pipelines: data.pipelines ?? serialized });
}
```

- [ ] **Step 5: Playground handler を追加する**

`PlaygroundModal` の Run で current direction pipeline を送る。

```tsx
async function handlePlaygroundRun(message: string, connectionInfo: unknown) {
  const serialized = graphToPipelines(state.graphs);
  const pipeline = serialized[state.direction] ?? [];
  const result = await evaluatePipeline({ pipeline, message, connectionInfo });
  dispatch({ type: 'playgroundResultLoaded', result });
}
```

- [ ] **Step 6: tests を通す**

Run:

```bash
deno test --allow-read admin/islands/pipeline/workbench_reducer.test.ts src/admin/pipelines-static.test.ts
deno check admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/api_client.ts
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/api_client.ts admin/islands/pipeline/workbench_reducer.ts admin/islands/pipeline/workbench_reducer.test.ts src/admin/pipelines-static.test.ts
git commit -m "Wire pipeline workbench island persistence"
```

## Task 9: Remove Legacy `pipelines.js`

**Files:**

- Delete: `admin/static/pipelines.js`
- Modify: `admin/static/fresh_nav.js`
- Modify: `admin/main.test.ts`
- Modify: `src/admin/pipelines-static.test.ts`
- Modify: `docs/current-architecture.md`

- [ ] **Step 1: stale reference test を固定する**

`admin/main.test.ts` の pipelines page test に追加する。

```ts
assertEquals(html.includes('/admin/static/pipelines.js'), false);
assertEquals(html.includes('initPipelinesPage'), false);
```

- [ ] **Step 2: `fresh_nav.js` mapping から pipelines entry を消す**

`PAGE_INITIALIZERS` から以下を削除する。

```js
'/admin/static/pipelines.js': 'initPipelinesPage',
```

- [ ] **Step 3: `admin/static/pipelines.js` を削除する**

```bash
git rm admin/static/pipelines.js
```

- [ ] **Step 4: tests の import をすべて新 module にする**

`src/admin/pipelines-static.test.ts` に `../../admin/static/pipelines.js` import が残っていないことを確認する。

Run:

```bash
rg -n "admin/static/pipelines\\.js|initPipelinesPage|/admin/static/pipelines\\.js" admin src docs/current-architecture.md
```

Expected: `admin/static/pipelines.js` への active reference は 0 件。

- [ ] **Step 5: docs を更新する**

`docs/current-architecture.md` の Admin UI section を更新する。

```md
- `admin/islands/PipelineWorkbench.tsx`: Pipeline Workbench の client-side composition root。
- `admin/islands/pipeline/*`: graph canvas、toolbar、palette、modals、API client、reducer。
```

`admin/static/pipelines.js` の記述は削除する。

- [ ] **Step 6: targeted tests を通す**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/page_routes.test.ts src/admin/pipelines-static.test.ts
deno check admin/main.ts admin/routes/pipelines.tsx admin/islands/PipelineWorkbench.tsx
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add admin/static/fresh_nav.js admin/main.test.ts src/admin/pipelines-static.test.ts docs/current-architecture.md
git add -u admin/static/pipelines.js
git commit -m "Replace legacy pipeline workbench script"
```

## Task 10: Browser QA and Visual Polish

**Files:**

- Modify: `admin/static/styles.css`
- Modify: affected island components only if QA finds concrete layout defects.

- [ ] **Step 1: start local admin server**

Create `/tmp/pfortner-fresh-admin.yaml` with:

```yaml
server:
  port: 39117
  upstream_relay: ws://localhost:7777
admin:
  enabled: true
  auth_token: test-token
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
```

Run:

```bash
deno run --unstable-net --allow-env --allow-net --allow-read --allow-write=/tmp/pfortner-fresh-admin.yaml,/tmp/pfortner-fresh-admin.yaml.workbench.json scripts/serve.ts /tmp/pfortner-fresh-admin.yaml
```

- [ ] **Step 2: Playwright QA を実行する**

QA script は `/tmp/admin-workbench-island-qa.ts` に置く。確認 flow:

```ts
await page.goto(`${baseUrl}/admin/login`);
await page.fill('input[name="token"]', token);
await page.click('button[type="submit"]');
await page.click('a[href="/admin/pipelines"]');
await expect(page.locator('.pipeline-workbench')).toBeVisible();
await page.click('text=Server');
await expect(page.locator('.canvas-toolbar')).toContainText('Server');
await page.click('.policy-palette-item', { trial: true });
await page.click('text=Save');
await page.click('text=Load');
await page.click('text=Publish');
```

Expected: console error と page error が 0 件。desktop 1440x1000 と mobile 390x844 で screenshot を保存する。

- [ ] **Step 3: QA findings を修正する**

修正は layout overlap、button text overflow、modal viewport overflow、partial navigation 後の duplicate mount に限定する。新機能は追加しない。

- [ ] **Step 4: final verification を通す**

Run:

```bash
deno fmt --check
deno lint
deno check admin/main.ts admin/routes/pipelines.tsx admin/islands/PipelineWorkbench.tsx
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/page_routes.test.ts admin/api_routes.test.ts src/admin/pipelines-static.test.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/
rg -n "admin/static/pipelines\\.js|initPipelinesPage|import \\{ boot \\} from \"\"" admin src deno.json docs/current-architecture.md
```

Expected:

- `deno fmt --check`: PASS。
- `deno lint`: PASS。
- `deno check`: PASS。
- targeted tests: PASS。
- `src/` tests: PASS。
- final `rg`: no output。

- [ ] **Step 5: Commit**

```bash
git add admin/static/styles.css admin/islands admin/main.test.ts docs/current-architecture.md
git commit -m "Polish pipeline workbench island QA"
```

## Task 11: Final Review

**Files:**

- No planned edits unless verification finds a defect.

- [ ] **Step 1: inspect final diff**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: worktree clean, latest commits are the task commits above.

- [ ] **Step 2: summarize residual risk**

Record in final response:

- Fresh island bootstrap gate passed or the implementation stopped before deleting legacy editor.
- Browser QA screenshots path.
- Tests run and result.
- Any skipped verification with reason.

## Execution Notes

- Do not delete `admin/static/pipelines.js` before Task 9.
- Do not keep both old and new workbench active in the final state.
- Do not change runtime pipeline config semantics; graph still serializes to `pipelines.client` / `pipelines.server`.
- Do not add a graph editor dependency.
- Keep commits atomic. If a task requires follow-up fixes before tests pass, include those fixes in the same task commit.
