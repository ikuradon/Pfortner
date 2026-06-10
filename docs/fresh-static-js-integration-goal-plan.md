# Fresh Static JavaScript Integration Goal Plan

作成日: 2026-06-10

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or an equivalent task-by-task execution workflow. Steps use checkbox (`- [ ]`) syntax for tracking. Keep commits atomic and do not mark the thread goal complete until every completion gate in this document is verified against the current worktree and a browser run.

**Goal:** `admin/static` 配下の JavaScript を Fresh の island / module / Partial 前提へ再編し、URL 直参照の static script 依存を段階的に削減する。

**Architecture:** `static/` は URL で直接参照される本物の静的 asset だけを置く。code から import される pure helper と interactive behavior は `admin/islands/pipeline/`、page-local island、または将来の Fresh client entry へ移し、Fresh の server render と island hydration を source of truth にする。移行中に必要な互換 shim は小さく保ち、各 phase の完了時に削除条件を明記する。

**Tech Stack:** Deno, Fresh 2.x, Preact, Fresh `Partial`, `f-client-nav`, admin JSON APIs, existing Deno fake DOM tests, Playwright browser QA.

---

## Authoritative Inputs

- Fresh docs: islands は `islands/` または route-local island として定義し、Fresh が client interactivity を配信する。
- Fresh docs: code から import する JavaScript/TypeScript/CSS/assets は `static/` 外に置き、`static/` は URL 参照 asset に限定する。
- `docs/current-architecture.md`: `/admin/*` は Fresh-rendered page、`Layout` は `f-client-nav` と `Partial` を使い、`admin/static/fresh_nav.js` は programmatic Fresh app の移行 runtime として残っている。
- Active thread goal: helper extraction、PipelineWorkbench static bridge の Fresh island 統合、page-local behavior の island/client entry 整理、`f-client-nav` / `Partial` 整合、SSR、ブラウザ操作、Deno 検証、atomic commit を全て完了する。

## Current State Snapshot

- `admin/static/islands/PipelineWorkbench.js` is the largest remaining static script and owns the browser workbench interaction.
- `admin/islands/PipelineWorkbench.tsx` already exists as the Fresh island composition root, but `Canvas.tsx` is mostly static render and does not yet own parity interactions such as drag, pan, minimap viewport drag, edge rewiring, and pointer selection.
- `admin/islands/pipeline/workbench_reducer.ts` owns important graph state transitions, but still imports pure helpers from `admin/static`.
- `admin/islands/pipeline/graph.js`, `admin/islands/pipeline/workbench_state.js`, and `admin/islands/pipeline/config_editor.js` are the Fresh-side pure helper modules.
- `admin/static/pipeline_graph.js`, `admin/static/pipeline_workbench_state.js`, and `admin/static/pipeline_config_editor.js` remain temporary browser compatibility copies for the static Workbench bridge.
- `admin/static/fresh_nav.js` is a custom partial navigation runtime that re-imports page-local static modules and mounts hand-written static island chunks.
- `admin/static/{dashboard,connections,metrics,blocklist,config,logs}.js` are page-local behavior modules attached to SSR markup.
- `admin/fresh_islands.ts` uses `@fresh/core/internal` to register handwritten island chunks, including `/admin/static/islands/PipelineWorkbench.js`.

## Final Completion Gates

- [ ] `admin/islands/PipelineWorkbench.tsx` and its `admin/islands/pipeline/*` modules own Workbench browser interactions through Preact hooks/reducer state, not through the hand-written `admin/static/islands/PipelineWorkbench.js` controller.
- [ ] No island/reducer/component code imports implementation from `admin/static/*.js`.
- [ ] Pure helper implementation files live outside `admin/static`; any remaining `admin/static/pipeline_*.js` files are tiny transitional URL compatibility shims or are removed.
- [ ] `admin/static/islands/PipelineWorkbench.js` is removed or reduced to a generated/compatibility artifact that no longer contains Workbench behavior.
- [ ] `admin/fresh_islands.ts` no longer needs to register `PipelineWorkbench` as a handwritten static chunk, or the remaining bridge is documented as a minimal Fresh runtime compatibility layer with no Workbench behavior.
- [ ] Page-local behavior is either migrated into islands/client entry modules or documented as intentionally URL-addressed static behavior with a removal plan and tests.
- [ ] `f-client-nav` and Fresh `Partial` navigation still update sidebar/content, rehydrate required islands, and avoid stale page-local handlers after navigation.
- [ ] SSR for `/admin/`, `/admin/connections`, `/admin/pipelines`, `/admin/metrics`, `/admin/blocklist`, `/admin/config`, `/admin/logs`, and `/admin/login` still renders without requiring client JavaScript for the initial HTML shell.
- [ ] Browser QA proves `/admin/pipelines` can load, switch Client/Server state, add nodes, move nodes, pan/zoom, drag the minimap viewport, open settings, save/load DAG, publish, and run playground.
- [ ] Deno verification passes with the current repo commands before the final commit.

## Phase 0: Plan And Baseline Audit

**Files:**

- Create: `docs/fresh-static-js-integration-goal-plan.md`
- Read: `docs/current-architecture.md`
- Read: `admin/main.ts`
- Read: `admin/fresh_islands.ts`
- Read: `admin/static/fresh_nav.js`
- Read: `admin/static/fresh_nav.test.js`
- Read: `admin/islands/PipelineWorkbench.tsx`
- Read: `admin/islands/pipeline/*`

- [x] **Step 1: Record the migration target**

  Add this document and keep it as the active goal checklist.

- [x] **Step 2: Verify the baseline is clean**

  Run:

  ```bash
  git status --short
  ```

  Expected: no unrelated dirty files before implementation. If dirty files exist, inspect them and do not revert user changes.

- [x] **Step 3: Commit the plan**

  Run:

  ```bash
  git add docs/fresh-static-js-integration-goal-plan.md
  git commit -m "Document Fresh static JS integration plan"
  ```

## Phase 1: Move Pure Helpers Out Of Static

**Files:**

- Create: `admin/islands/pipeline/graph.js`
- Create: `admin/islands/pipeline/workbench_state.js`
- Create: `admin/islands/pipeline/config_editor.js`
- Modify: `admin/static/pipeline_graph.js`
- Modify: `admin/static/pipeline_workbench_state.js`
- Modify: `admin/static/pipeline_config_editor.js`
- Modify: `admin/islands/PipelineWorkbench.tsx`
- Modify: `admin/islands/pipeline/workbench_reducer.ts`
- Modify: `admin/islands/pipeline/workbench_reducer.test.ts`
- Modify: `src/admin/pipelines-static.test.ts`

- [x] **Step 1: Write import-boundary tests**

  Add assertions that island/reducer imports point at `admin/islands/pipeline/*`, not `admin/static/*`.

  Run:

  ```bash
  rg -n "../static|../../static" admin/islands
  ```

  Expected while red: matches in `PipelineWorkbench.tsx`, `workbench_reducer.ts`, and `workbench_reducer.test.ts`.

- [x] **Step 2: Move `pipeline_graph` implementation**

  Move the implementation body into `admin/islands/pipeline/graph.js`. Preserve these named exports:

  - `graphToPipelines`
  - `pipelinesToGraph`
  - `validatePipelineGraph`
  - `matchExecutionSteps`

  Keep `admin/static/pipeline_graph.js` as a temporary browser compatibility copy while `admin/static/islands/PipelineWorkbench.js` still imports it. Do not make the static file re-export `../islands/pipeline/graph.js`, because that relative URL would resolve to `/admin/islands/pipeline/graph.js` in the browser and the admin static file server does not serve that path.

- [x] **Step 3: Move `pipeline_workbench_state` implementation**

  Move the implementation body into `admin/islands/pipeline/workbench_state.js`. Preserve these named exports:

  - `WORKBENCH_DRAFT_VERSION`
  - `LOCAL_DRAFT_KEY`
  - `PALETTE_COLLAPSED_KEY`
  - `LAST_DIRECTION_KEY`
  - `fingerprintPipelines`
  - `initialHistoryState`
  - `initialDirectionHistoryState`
  - `recordHistorySnapshot`
  - `recordDirectionHistorySnapshot`
  - `applyHistoryChange`
  - `isUndoAvailable`
  - `isRedoAvailable`
  - `buildPipelineDraft`
  - `normalizeWorkbenchDraft`
  - `hasUnpublishedChanges`
  - `getWorkbenchChangeState`

  Keep `admin/static/pipeline_workbench_state.js` as a temporary browser compatibility copy while `admin/static/islands/PipelineWorkbench.js` still imports it. Remove or shrink it only after Phase 2 removes the static Workbench bridge.

- [x] **Step 4: Move `pipeline_config_editor` implementation**

  Move the implementation body into `admin/islands/pipeline/config_editor.js`. Preserve these named exports:

  - `shouldRenderSettingsAction`
  - `shouldRenderRunAction`
  - `shouldOpenPlaygroundForNode`
  - `parseConfigJson`
  - `configToEditorRows`
  - `updateConfigFromEditorRows`

  Keep `admin/static/pipeline_config_editor.js` as a temporary browser compatibility copy while `admin/static/islands/PipelineWorkbench.js` still imports it. Remove or shrink it only after Phase 2 removes the static Workbench bridge.

- [x] **Step 5: Update code imports**

  Update island code and tests:

  - `admin/islands/PipelineWorkbench.tsx` imports from `./pipeline/graph.js` and `./pipeline/workbench_state.js`.
  - `admin/islands/pipeline/workbench_reducer.ts` imports from `./graph.js` and `./workbench_state.js`.
  - `admin/islands/pipeline/workbench_reducer.test.ts` imports from `./graph.js` and `./workbench_state.js`.
  - `src/admin/pipelines-static.test.ts` keeps static shim imports to prove transitional URL compatibility.
  - `admin/islands/pipeline/import_boundary.test.ts` recursively checks `admin/islands` and fails if island code imports `../static/` or `../../static/`.

- [x] **Step 6: Verify helper extraction**

  Run:

  ```bash
  deno fmt --check --config deno.json
  deno check admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/workbench_reducer.ts admin/islands/pipeline/import_boundary.test.ts src/admin/pipelines-static.test.ts
  deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/pipelines-static.test.ts admin/islands/pipeline/workbench_reducer.test.ts admin/static/fresh_nav.test.js
  ```

  Expected: all pass. `admin/static/fresh_nav.test.js` must still pass because the old static bridge still imports the static shim.

- [x] **Step 7: Commit helper extraction**

  Run:

  ```bash
  git add docs/fresh-static-js-integration-goal-plan.md admin/islands/PipelineWorkbench.tsx admin/islands/pipeline/graph.js admin/islands/pipeline/workbench_state.js admin/islands/pipeline/config_editor.js admin/islands/pipeline/import_boundary.test.ts admin/islands/pipeline/workbench_reducer.ts admin/islands/pipeline/workbench_reducer.test.ts
  git commit -m "Move pipeline helpers out of static"
  ```

## Phase 2: Make PipelineWorkbench A Real Fresh Island

**Files:**

- Modify: `admin/islands/PipelineWorkbench.tsx`
- Modify: `admin/islands/pipeline/Canvas.tsx`
- Create: `admin/islands/pipeline/use_canvas_interactions.ts`
- Create: `admin/islands/pipeline/minimap.ts`
- Modify: `admin/islands/pipeline/workbench_reducer.ts`
- Modify: `admin/islands/pipeline/workbench_reducer.test.ts`
- Modify: `admin/static/fresh_nav.test.js`
- Modify: `admin/static/styles.css`
- Modify or remove: `admin/static/islands/PipelineWorkbench.js`
- Modify: `admin/fresh_islands.ts`

- [ ] **Step 1: Add red tests for island-owned rendering and interactions**

  Add or split tests so the expected public behavior is expressed against Fresh island DOM instead of `mountPipelineWorkbench` internals:

  - Workbench initial render includes start nodes for both directions after load.
  - Palette add updates the active direction graph.
  - Node pointer drag dispatches `nodeMoved`.
  - Wheel pans and modifier-wheel zooms by dispatching `viewportChanged`.
  - Minimap viewport is rendered and dragging it dispatches `viewportChanged`.
  - Output-to-input pointer wiring dispatches `edgeReplaced`.
  - Double click and gear action open settings; start node run action opens playground.

  Expected while red: tests fail because `Canvas.tsx` is not yet interactive.

- [x] **Step 2: Port viewport state into rendered Canvas**

  `PipelineWorkbench.tsx` must pass the active viewport and `onViewportChange` to `Canvas`.

  `Canvas.tsx` must render:

  - a stable world layer transformed by `translate(pan.x, pan.y) scale(zoom)`;
  - a zoom label derived from reducer state;
  - a minimap with graph extents and a `.minimap-viewport` rectangle.

- [ ] **Step 3: Port pointer interactions into hooks**

  `use_canvas_interactions.ts` must own browser-only event state:

  - node drag start/move/end;
  - canvas panning by wheel;
  - cursor-centered zoom by Ctrl/Cmd wheel;
  - minimap viewport dragging;
  - connection drag from output port to input port;
  - selection updates.

  The hook must only dispatch reducer actions and must not mutate DOM state as the source of truth.

  Progress:

  - [x] Added `admin/islands/pipeline/use_canvas_interactions.ts` with pure viewport pan/zoom, graph point, node drag, and minimap point helpers.
  - [x] Wired Fresh `Canvas` wheel pan/zoom, node pointer drag, and minimap pointer drag callbacks to reducer dispatch through `PipelineWorkbench.tsx`.
  - [x] Move connection drag from output port to input port into the hook.
  - [x] Move selection and marquee behavior into reducer-backed Fresh island state.
  - [x] Move toolbar Fit/Zoom controls into Fresh island viewport helpers and reducer dispatch.
  - [x] Move node Run/Settings action controls into Fresh island `Canvas` rendering.
  - [x] Move settings modal Delete Node action into Fresh island reducer dispatch.
  - [x] Move Workbench keyboard shortcuts for Escape, Undo/Redo, and selected-node deletion into a Fresh island hook.

- [ ] **Step 4: Preserve settings/playground/save/load/publish parity**

  Keep existing Fresh island modal code as the source of truth and ensure static bridge tests are either migrated to island tests or kept only for the remaining shim.

  Progress:

  - [x] Extracted Save/Load/Publish/Playground side effects into `admin/islands/pipeline/workbench_actions.ts` with injectable services and reducer action tests.
  - [x] Removed the Fresh island toolbar Run no-op so playground launch is owned by the start-node action.
  - [x] Pass active config pipelines and plugin names into `PipelineWorkbench` as SSR props so the initial graph render no longer depends on client-side config/plugin fetches.
  - [x] Stop `PipelineWorkbench` from fetching active config and plugin lists after SSR render; mount-time loading now checks only saved DAG drafts.
  - [x] Remove the legacy `initialDataLoaded` reducer action and unused active config/plugin client fetchers.

- [ ] **Step 5: Shrink or remove the static bridge**

  Remove `mountPipelineWorkbench` behavior from `admin/static/islands/PipelineWorkbench.js`. If Fresh programmatic build still requires a chunk path during transition, make the file a minimal compatibility module with no graph/controller behavior and document the removal gate in `admin/fresh_islands.ts`.

- [ ] **Step 6: Browser QA**

  Start the admin dev server and verify `/admin/pipelines` with Playwright:

  - page renders after login/auth setup used by existing tests;
  - start node visible;
  - adding, moving, connecting, panning, zooming, minimap dragging work;
  - settings and playground modals work;
  - Save, Load, Publish UI flows still call the expected APIs.

- [ ] **Step 7: Commit Fresh island workbench integration**

  Run full verification first, then commit:

  ```bash
  git add admin/islands/PipelineWorkbench.tsx admin/islands/pipeline admin/static/islands/PipelineWorkbench.js admin/static/fresh_nav.test.js admin/static/styles.css admin/fresh_islands.ts
  git commit -m "Move workbench interactions into Fresh island"
  ```

## Phase 3: Rehome Page-Local Behavior

**Files:**

- Modify or create islands for dashboard, connections, metrics, blocklist, config, and logs.
- Modify: `admin/routes/*.tsx`
- Modify: `admin/static/fresh_nav.js`
- Modify: `admin/static/fresh_nav.test.js`
- Modify: `docs/current-architecture.md`

- [ ] **Step 1: Classify each page-local script**

  For each file, decide the target:

  - `dashboard.js`: island if timers/fetching are page-specific; otherwise server-only snapshot plus minimal refresh island.
  - `connections.js`: island because it owns row actions and refresh behavior.
  - `metrics.js`: island because it owns chart/refresh behavior.
  - `blocklist.js`: island because it owns form submission and list mutation.
  - `config.js`: island only if editing interaction remains client-side.
  - `logs.js`: island because it owns streaming/log filtering behavior.
  - `client.js`: layout-level client entry or island only for global UI behavior.

  Progress:

  - [x] Moved the layout theme toggle from `admin/static/client.js` into the existing Fresh client entry `admin/static/fresh_nav.js`, then removed the separate `client.js` URL script.
  - [x] Moved Dashboard page polling/rendering from `admin/static/dashboard.js` into `admin/static/fresh_nav.js`, then removed the separate `dashboard.js` URL script.
  - [x] Moved Config page read/reload behavior from `admin/static/config.js` into `admin/static/fresh_nav.js`, then removed the separate `config.js` URL script.
  - [x] Moved Blocklist page add/delete/list behavior from `admin/static/blocklist.js` into `admin/static/fresh_nav.js`, then removed the separate `blocklist.js` URL script.

- [ ] **Step 2: Migrate one page at a time**

  For each page:

  - add a failing partial navigation test that catches duplicated listeners or missing reinitialization;
  - move behavior into a route island or shared admin client entry module outside `admin/static`;
  - remove its path from `PAGE_INITIALIZERS`;
  - keep SSR markup useful before JavaScript loads;
  - run targeted page tests before committing.

  Progress:

  - [x] Dashboard page no longer renders `/admin/static/dashboard.js` or `/admin/static/utils.js`; `fresh_nav` initializes the page on initial boot and after Fresh partial replacement.
  - [x] Config page no longer renders `/admin/static/config.js` or `/admin/static/utils.js`; `fresh_nav` initializes the page on initial boot and after Fresh partial replacement.
  - [x] Blocklist page no longer renders `/admin/static/blocklist.js` or `/admin/static/utils.js`; `fresh_nav` initializes the page on initial boot and after Fresh partial replacement.

- [ ] **Step 3: Commit each page separately**

  Use commit names like:

  ```bash
  git commit -m "Move logs behavior into Fresh island"
  git commit -m "Move metrics behavior into Fresh island"
  ```

## Phase 4: Reduce Custom Fresh Runtime Bridge

**Files:**

- Modify: `admin/main.ts`
- Modify: `admin/fresh_islands.ts`
- Modify: `admin/static/fresh_nav.js`
- Modify: `admin/static_fresh_nav.test.js` if split later
- Modify: `deno.json` only if a standard Fresh/Vite client build is introduced
- Create: `vite.config.ts` only if the programmatic `/admin` app can be moved to a standard Fresh build path without breaking the server integration

- [ ] **Step 1: Decide Fresh runtime strategy from evidence**

  Inspect whether the programmatic `/admin` app can use standard Fresh/Vite island chunk generation in this repo without changing public server startup. Do not introduce Vite merely to remove a small bridge if it makes deployment or scripts less reliable.

- [ ] **Step 2: Remove `@fresh/core/internal` dependency if feasible**

  If standard Fresh build is feasible:

  - remove `installAdminIslandBuildCache`;
  - remove handwritten island chunk registration;
  - replace `withAdminFreshRuntime` script rewriting with standard Fresh client entry behavior.

  If not feasible in this iteration:

  - keep a minimal bridge only for `f-client-nav` and `Partial` replacement;
  - document why the bridge remains;
  - ensure the bridge does not mount Workbench or page-local behavior directly.

- [ ] **Step 3: Commit runtime bridge reduction**

  Run targeted SSR and partial navigation tests, then commit.

## Phase 5: Full Verification And Goal Completion Audit

**Files:**

- Modify: `docs/current-architecture.md`
- Modify: `docs/fresh-static-js-integration-goal-plan.md`

- [ ] **Step 1: Update architecture docs**

  `docs/current-architecture.md` must describe the final `admin/static` boundary, Fresh islands, remaining client entry behavior, and any intentionally retained compatibility bridge.

- [ ] **Step 2: Run static dependency audit**

  Run:

  ```bash
  rg -n "../static|../../static|/admin/static/islands/PipelineWorkbench.js|PAGE_INITIALIZERS|mountPipelineWorkbench" admin src docs
  ```

  Expected: no Workbench behavior dependency on static implementation. Any remaining matches must be explicitly documented static URL assets or transitional compatibility shims.

- [ ] **Step 3: Run Deno verification**

  Run:

  ```bash
  deno fmt --check --config deno.json
  deno lint
  deno check mod.ts admin/main.ts admin/islands/PipelineWorkbench.tsx admin/static/fresh_nav.js
  deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/ src/
  ```

  Expected: all pass, excluding only documented environment socket restrictions if they recur.

- [ ] **Step 4: Run browser verification**

  Use Browser plugin if available; otherwise use Playwright and record that Browser plugin is unavailable. Verify at least:

  - `/admin/` initial SSR shell;
  - sidebar `f-client-nav` navigation to every admin page;
  - `/admin/pipelines` Workbench full interaction parity;
  - back/forward navigation;
  - no console errors from stale static script imports.

- [ ] **Step 5: Commit docs and final cleanup**

  Commit final documentation and cleanup after all tests pass.

- [ ] **Step 6: Complete the active goal**

  Only after all final gates are proven, call `update_goal` with `status: complete`.
