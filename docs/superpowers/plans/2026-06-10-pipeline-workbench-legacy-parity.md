# Pipeline Workbench Legacy Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現在の Fresh / Partial / island bootstrap を維持しながら、削除前の pipeline workbench UI をユーザー可視機能レベルで完全再現する。

**Architecture:** `admin/static/pipelines.js` は戻さず、commit `9a446a2^` の controller behavior を `admin/static/islands/PipelineWorkbench.js` へ移植する。Preact island component は SSR shell として旧 controller が必要とする DOM anchor を出し、browser interaction の authoritative 実装は static chunk に置く。

**Tech Stack:** Deno, Fresh 2.x programmatic `App`, `f-client-nav` / Partial navigation, Preact SSR shell, SVG, localStorage, existing admin JSON APIs, existing pure helpers in `admin/static/*.js`, Playwright QA.

---

## Spec

実装基準は `docs/superpowers/specs/2026-06-10-pipeline-workbench-legacy-parity-design.md`。

旧UI基準は次のコマンドで参照できる。

```bash
git show 9a446a2^:admin/static/pipelines.js
```

## File Structure

- Modify `admin/static/islands/PipelineWorkbench.js`: 旧 controller behavior を island static chunk として移植する。import path、mount entry、duplicate binding cleanup、Fresh partial navigation 対応を調整する。
- Modify `admin/islands/pipeline/Toolbar.tsx`: Fit / Zoom controls を SSR shell に戻す。Run は disabled にしない。
- Modify `admin/islands/pipeline/Canvas.tsx`: `#selection-marquee` と `#minimap-svg` を含む旧 controller 用 canvas shell に戻す。branch ports の first paint markup も static chunk と同じ data attributes にする。
- Modify `admin/islands/pipeline/Palette.tsx`: palette item を draggable に戻す。
- Modify `admin/islands/PipelineWorkbench.tsx`: Toolbar props、Canvas props、status / badge / shell markup を旧 controller anchor と同期する。
- Modify `admin/static/styles.css`: toolbar wrap、minimap、marquee、branch port label、mobile scaling の破壊を修正する。
- Modify `admin/static/fresh_nav.test.js`: fake DOM tests で parity behaviors を固定する。
- Modify `src/admin/pipelines-static.test.ts`: pure helper parity と branch serialization / editor helper tests を必要に応じて追加する。
- Optional modify `admin/main.test.ts`: rendered HTML に Fit / Zoom / minimap anchors があることを固定する。

## Task 1: Plan And Parity Spec

**Files:**

- Create: `docs/superpowers/specs/2026-06-10-pipeline-workbench-legacy-parity-design.md`
- Create: `docs/superpowers/plans/2026-06-10-pipeline-workbench-legacy-parity.md`

- [ ] **Step 1: spec を保存する**

保存先:

```text
docs/superpowers/specs/2026-06-10-pipeline-workbench-legacy-parity-design.md
```

必須セクション:

```markdown
## 基準仕様
## 現状の問題
## 方針
## UI 要件
## Data 要件
## テスト要件
## Completion Definition
```

- [ ] **Step 2: plan を保存する**

保存先:

```text
docs/superpowers/plans/2026-06-10-pipeline-workbench-legacy-parity.md
```

- [ ] **Step 3: docs の自己確認**

Run:

```bash
rg -n -f /tmp/pfortner-plan-red-flags docs/superpowers/specs/2026-06-10-pipeline-workbench-legacy-parity-design.md docs/superpowers/plans/2026-06-10-pipeline-workbench-legacy-parity.md
```

Expected: no matches. `/tmp/pfortner-plan-red-flags` は plan 本文に pattern 文字列を自己一致させないための一時 file とする。

- [ ] **Step 4: commit**

```bash
git add docs/superpowers/specs/2026-06-10-pipeline-workbench-legacy-parity-design.md docs/superpowers/plans/2026-06-10-pipeline-workbench-legacy-parity.md
git commit -m "Plan pipeline workbench legacy parity"
```

## Task 2: Static Chunk Parity Controller

**Files:**

- Modify: `admin/static/islands/PipelineWorkbench.js`
- Test: `admin/static/fresh_nav.test.js`

- [ ] **Step 1: failing tests を追加する**

`admin/static/fresh_nav.test.js` に以下の behaviors を追加する。

```js
Deno.test('PipelineWorkbench static chunk exposes legacy canvas controls', async () => {
  const fixture = await mountPipelineWorkbenchFixture();

  assertEquals(document.querySelector('#btn-fit-canvas') !== null, true);
  assertEquals(document.querySelector('#btn-zoom-in') !== null, true);
  assertEquals(document.querySelector('#btn-zoom-out') !== null, true);
  assertEquals(document.querySelector('#selection-marquee') !== null, true);
  assertEquals(document.querySelector('#minimap-svg') !== null, true);
  assertEquals(fixture.runButton?.hasAttribute('disabled'), false);
});

Deno.test('PipelineWorkbench static chunk renders branch ports for when and match nodes', async () => {
  const fixture = await mountPipelineWorkbenchFixture({
    draft: {
      version: 1,
      graphs: {
        client: {
          direction: 'client',
          nodes: [
            { id: 'client-start', type: 'start', policy: 'start', x: 0, y: 0, config: {} },
            { id: 'client-node-1', type: 'policy', policy: 'when', x: 240, y: 0, config: { condition: {}, then: [], else: [] } },
            { id: 'client-node-2', type: 'policy', policy: 'match', x: 240, y: 140, config: { cases: [{ condition: {}, pipeline: [] }], default: [] } },
          ],
          edges: [
            { id: 'client-edge-1', from: 'client-start', fromPort: 'next', to: 'client-node-1', toPort: 'in' },
          ],
        },
        server: { direction: 'server', nodes: [{ id: 'server-start', type: 'start', policy: 'start', x: 0, y: 0, config: {} }], edges: [] },
      },
      viewports: {},
      updatedAt: new Date().toISOString(),
      lastPublishedFingerprint: '',
    },
  });

  await fixture.waitForLoad();

  assertEquals(document.querySelector('[data-node-id="client-start"][data-port-role="input"]'), null);
  assertEquals(document.querySelector('[data-node-id="client-node-1"][data-port-id="then"]') !== null, true);
  assertEquals(document.querySelector('[data-node-id="client-node-1"][data-port-id="else"]') !== null, true);
  assertEquals(document.querySelector('[data-node-id="client-node-2"][data-port-id="case:0"]') !== null, true);
  assertEquals(document.querySelector('[data-node-id="client-node-2"][data-port-id="default"]') !== null, true);
});
```

実際の fixture 名が違う場合は既存 helper に合わせる。テスト名と期待 behavior は維持する。

- [ ] **Step 2: RED を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js
```

Expected: FAIL。Fit / Zoom / minimap / branch ports のいずれかが見つからない。

- [ ] **Step 3: 旧 controller を island static chunk へ移植する**

実装方針:

1. `git show 9a446a2^:admin/static/pipelines.js` の内容を基準にする。
2. import path を static island chunk 位置に合わせる。
3. top-level `DOMContentLoaded` auto init を削除する。
4. `export default function PipelineWorkbench() { return null; }` を残す。
5. `PipelineWorkbench.mount = function mountPipelineWorkbench(root) { ... }` を追加し、`initPipelinesPage()` を呼ぶ。
6. mount 前に `#pipeline-workbench` がない場合は return する。
7. mount は Fresh partial navigation で再実行可能にし、旧 `controlsAbortController` cleanup を使って重複 binding を避ける。

必要な先頭 import:

```js
import { graphToPipelines, matchExecutionSteps, pipelinesToGraph, validatePipelineGraph } from '../pipeline_graph.js';
import {
  addMatchCaseDraftConfig,
  removeMatchCaseDraftConfig,
  reconcileMatchCaseEdges,
} from '../pipeline_config_editor.js';
import {
  buildPipelineDraft,
  fingerprintPipelines,
  getWorkbenchChangeState,
  initialDirectionHistoryState,
  isRedoAvailable,
  isUndoAvailable,
  LAST_DIRECTION_KEY,
  LOCAL_DRAFT_KEY,
  normalizeWorkbenchDraft,
  PALETTE_COLLAPSED_KEY,
  recordDirectionHistorySnapshot,
  applyHistoryChange,
} from '../pipeline_workbench_state.js';
```

旧 file 内で同名 helper が存在する場合は、現在の helper export に合わせて import と local definition を整理する。

- [ ] **Step 4: static chunk の export marker を維持する**

`admin/main.test.ts` が期待する `mountPipelineWorkbench` 文字列を維持する。

```js
export default function PipelineWorkbench() {
  return null;
}

PipelineWorkbench.mount = function mountPipelineWorkbench(root) {
  const workbench = root.querySelector?.('#pipeline-workbench');
  if (!workbench) return;
  initPipelinesPage();
};
```

- [ ] **Step 5: GREEN を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js admin/main.test.ts src/admin/pipelines-static.test.ts
```

Expected: PASS。

- [ ] **Step 6: commit**

```bash
git add admin/static/islands/PipelineWorkbench.js admin/static/fresh_nav.test.js admin/main.test.ts src/admin/pipelines-static.test.ts
git commit -m "Restore pipeline workbench legacy controller parity"
```

## Task 3: SSR Shell Anchor Parity

**Files:**

- Modify: `admin/islands/pipeline/Toolbar.tsx`
- Modify: `admin/islands/pipeline/Canvas.tsx`
- Modify: `admin/islands/pipeline/Palette.tsx`
- Modify: `admin/islands/PipelineWorkbench.tsx`
- Modify: `admin/static/styles.css`
- Test: `admin/main.test.ts`
- Test: `admin/static/styles.test.ts`

- [ ] **Step 1: failing SSR anchor test を追加する**

`admin/main.test.ts` に追加する。

```ts
Deno.test('admin pipelines page renders legacy workbench canvas controls', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/pipelines', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();

  for (const id of [
    'btn-fit-canvas',
    'btn-zoom-in',
    'btn-zoom-out',
    'selection-marquee',
    'minimap-svg',
  ]) {
    assertEquals(html.includes(`id="${id}"`) || html.includes(`id='${id}'`), true, id);
  }
  assertEquals(html.includes('id="btn-run-pipeline" disabled'), false);
});
```

- [ ] **Step 2: RED を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/static/styles.test.ts
```

Expected: FAIL。SSR shell に controls が足りない。

- [ ] **Step 3: Toolbar を旧 controls に戻す**

`Toolbar.tsx` に Fit / Zoom out / Zoom in を追加し、Run の disabled を外す。

```tsx
<button type='button' id='btn-run-pipeline' class='btn btn-ghost' onClick={props.onRun}>
  ▷ Run
</button>
<button type='button' id='btn-fit-canvas' class='btn btn-ghost'>
  Fit
</button>
<button type='button' id='btn-zoom-out' class='btn btn-ghost' aria-label='Zoom out'>
  -
</button>
<button type='button' id='btn-zoom-in' class='btn btn-ghost' aria-label='Zoom in'>
  +
</button>
```

- [ ] **Step 4: Canvas shell に minimap / marquee を戻す**

`Canvas.tsx` の `pipeline-canvas` 内に以下を含める。

```tsx
<div class='selection-marquee' id='selection-marquee'></div>
<svg class='canvas-minimap minimap-svg' id='minimap-svg' aria-label='Pipeline minimap'></svg>
```

SVG 自体は static chunk が再描画するため、SSR first paint の node rendering は残してもよい。

- [ ] **Step 5: Palette item を draggable に戻す**

`Palette.tsx` の policy button に追加する。

```tsx
draggable
onDragStart={(event) => {
  event.dataTransfer?.setData('application/x-pfortner-policy', name);
  event.dataTransfer?.setData('text/plain', name);
}}
```

- [ ] **Step 6: styles を調整する**

`admin/static/styles.css` で mobile の `.pipeline-edge-layer, .pipeline-node-layer { transform: scale(...) }` は削除する。
zoom / pan は SVG viewport transform が担当するため、CSS scale と二重適用しない。

- [ ] **Step 7: GREEN を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/static/styles.test.ts
```

Expected: PASS。

- [ ] **Step 8: commit**

```bash
git add admin/islands/pipeline/Toolbar.tsx admin/islands/pipeline/Canvas.tsx admin/islands/pipeline/Palette.tsx admin/islands/PipelineWorkbench.tsx admin/static/styles.css admin/main.test.ts admin/static/styles.test.ts
git commit -m "Restore pipeline workbench SSR shell controls"
```

## Task 4: Branch Ports And Config Modal Parity

**Files:**

- Modify: `admin/static/islands/PipelineWorkbench.js`
- Modify: `admin/static/fresh_nav.test.js`
- Test: `src/admin/pipelines-static.test.ts`

- [ ] **Step 1: failing tests を追加する**

Add tests for:

- `when` output ports `then` and `else` are rendered and can be wired.
- `match` output ports `case:0` and `default` are rendered and can be wired.
- settings modal interactive rows can apply a config change.
- removing a match case removes or renumbers affected edges.

Use existing `addMatchCaseDraftConfig`, `removeMatchCaseDraftConfig`,
`reconcileMatchCaseEdges` tests in `src/admin/pipelines-static.test.ts` as pure helper coverage.

- [ ] **Step 2: RED を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js src/admin/pipelines-static.test.ts
```

Expected: FAIL on missing UI behavior, pure helper tests should remain PASS.

- [ ] **Step 3: output port renderer を旧 logic に合わせる**

`PipelineWorkbench.js` に旧 controller と同じ helper を維持する。

```js
function outputPortsFor(node) {
  if (node.policy === 'when') {
    return [
      { id: 'then', label: 'then' },
      { id: 'else', label: 'else' },
    ];
  }
  if (node.policy === 'match') {
    const cases = Array.isArray(node.config?.cases) ? node.config.cases : [];
    return cases.map((_, index) => ({
      id: `case:${index}`,
      label: `case ${index + 1}`,
    })).concat({ id: 'default', label: 'default' });
  }
  return [{ id: 'next', label: 'next' }];
}
```

- [ ] **Step 4: settings modal interactive mode を旧 logic に合わせる**

旧 `configRowsFromNode()`, `renderValueControl()`, `renderConfigRows()`,
`renderMatchCaseControls()`, `openNodeSettingsModal()` を static chunk で使う。
Apply 時は `reconcileMatchCaseEdges()` を通す。

- [ ] **Step 5: GREEN を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js src/admin/pipelines-static.test.ts
```

Expected: PASS。

- [ ] **Step 6: commit**

```bash
git add admin/static/islands/PipelineWorkbench.js admin/static/fresh_nav.test.js src/admin/pipelines-static.test.ts
git commit -m "Restore branch port and settings modal parity"
```

## Task 5: Viewport, Minimap, Selection, Keyboard

**Files:**

- Modify: `admin/static/islands/PipelineWorkbench.js`
- Modify: `admin/static/fresh_nav.test.js`

- [ ] **Step 1: failing tests を追加する**

Add tests for:

- wheel zoom updates `#canvas-zoom-label` and draft viewport.
- Fit button changes viewport from default.
- canvas background pointer drag pans.
- marquee selects multiple policy nodes.
- Delete removes selected policy nodes but not start.
- Ctrl/Cmd+Z and Ctrl/Cmd+Y undo / redo graph changes.
- Escape clears wire / selection or closes modal.

- [ ] **Step 2: RED を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js
```

Expected: FAIL on missing viewport / selection behavior.

- [ ] **Step 3: old viewport and interaction helpers を static chunk に維持する**

Required functions:

```text
graphPointFromEvent
startCanvasPointer
updateMarquee
finishMarquee
handlePointerMove
handlePointerUp
fitCanvas
setZoom
renderMinimap
deleteSelectedNodes
undoGraphChange
redoGraphChange
```

- [ ] **Step 4: GREEN を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js
```

Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add admin/static/islands/PipelineWorkbench.js admin/static/fresh_nav.test.js
git commit -m "Restore pipeline viewport and selection parity"
```

## Task 6: Playground Result And Execution Highlight Parity

**Files:**

- Modify: `admin/static/islands/PipelineWorkbench.js`
- Modify: `admin/static/fresh_nav.test.js`

- [ ] **Step 1: failing tests を追加する**

Add tests for:

- playground modal renders preset buttons and connection context fields.
- Run posts message, direction, connectionInfo, and current pipeline.
- successful result renders step list rather than only JSON dump.
- matched graph nodes receive `executed` class.
- invalid non-array message rejects before fetch.

- [ ] **Step 2: RED を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js
```

Expected: FAIL on missing presets / highlight.

- [ ] **Step 3: old playground renderer を static chunk に維持する**

Required functions:

```text
renderPresets
renderResults
renderError
updatePlaygroundStateFromDom
openPlaygroundModal
runEvaluation
```

- [ ] **Step 4: GREEN を確認する**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js
```

Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add admin/static/islands/PipelineWorkbench.js admin/static/fresh_nav.test.js
git commit -m "Restore pipeline playground result parity"
```

## Task 7: Browser QA And Full Verification

**Files:**

- Modify only if QA reveals concrete layout or interaction bugs.

- [ ] **Step 1: format / lint / type check**

Run:

```bash
deno fmt --check --config deno.json
deno lint
deno check admin/main.ts admin/routes/pipelines.tsx admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/Canvas.tsx admin/static/islands/PipelineWorkbench.js
```

Expected: all exit 0.

- [ ] **Step 2: targeted tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/fresh_nav.test.js admin/main.test.ts admin/page_routes.test.ts admin/api_routes.test.ts src/admin/pipelines-static.test.ts
```

Expected: all pass.

- [ ] **Step 3: repo tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/
```

Expected: all non-ignored tests pass.

- [ ] **Step 4: desktop Playwright QA**

Start admin app on an unused local port and verify:

- start node is visible.
- palette add creates a visible node.
- node drag updates edge.
- output to input wire works.
- branch ports are visible for `when` / `match`.
- Fit / Zoom / pan work.
- settings modal opens with Interactive and JSON tabs.
- playground fullscreen modal opens and can run.
- Save / Load / Publish modal work.
- console has no errors.

- [ ] **Step 5: mobile Playwright QA**

Verify:

- palette collapsed rail is usable.
- canvas and toolbar do not overlap.
- minimap hides if viewport is too narrow.
- node labels and buttons fit.
- modal body scrolls without clipped controls.

- [ ] **Step 6: final commit if QA fixes were needed**

```bash
git add admin/static/islands/PipelineWorkbench.js admin/static/styles.css admin/static/fresh_nav.test.js
git commit -m "Polish pipeline workbench legacy parity QA"
```

## Completion Checklist

- [ ] `admin/static/pipelines.js` remains absent.
- [ ] `/admin/pipelines` includes Fresh island marker and `/admin/static/islands/PipelineWorkbench.js`.
- [ ] Start node, existing nodes, and new palette nodes draw on first load.
- [ ] Start node has no input port.
- [ ] Nodes move by pointer drag.
- [ ] Canvas pan / zoom / fit work and are saved in DAG draft.
- [ ] Palette add and drag/drop add work.
- [ ] Output-to-input wiring works.
- [ ] `when` and `match` branch ports work.
- [ ] Settings modal supports Interactive and JSON mode.
- [ ] Playground fullscreen modal supports presets, context, result step list, and execution highlight.
- [ ] Save / Load / Publish use current graph and viewports.
- [ ] Undo / Redo cover node add/delete/move, edge edits, config apply, load replace.
- [ ] Keyboard shortcuts match the旧UI behavior.
- [ ] Desktop and mobile QA pass without layout overlap.
