# Pipeline Playground Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single `/admin/pipelines` workbench that combines graph-based pipeline editing with the existing Playground test run flow, while removing `/admin/playground` as a page.

**Architecture:** Keep the existing Deno admin SPA and static JavaScript architecture. Add a focused graph conversion module for testable pipeline graph behavior, then make `admin/static/pipelines.js` the integrated page controller for graph editor state, canvas interactions, inspector editing, YAML preview, and Test Run drawer.

**Tech Stack:** Deno, Preact server-rendered admin shell, static ES modules, vanilla JavaScript DOM APIs, SVG, existing `/admin/api/playground/evaluate`.

---

## File Structure

- Create `admin/static/pipeline_graph.js`: pure graph conversion, validation, execution matching, and layout helpers. No DOM access.
- Modify `src/admin/pipelines-static.test.ts`: graph conversion, validation, YAML, and execution highlight tests.
- Modify `admin/components/Sidebar.tsx`: remove the Playground nav item.
- Modify `admin/page_routes.ts`: remove `/playground` from registered SPA shell pages.
- Modify `admin/static/page_templates.js`: remove `/admin/playground` route and replace `renderPipelinesPage` with the workbench DOM.
- Modify `admin/static/page_templates.test.ts`: assert `/admin/playground` is gone and `/admin/pipelines` still maps to `pipelines.js`.
- Modify `admin/page_routes.test.ts`: assert `/admin/playground` is not registered.
- Modify `admin/main.test.ts`: assert `/admin/playground` returns 404.
- Modify `admin/api_routes.ts`: let the existing evaluate endpoint accept a request-scoped `pipeline` override for unsaved graph test runs.
- Modify `admin/api_routes.test.ts`: verify the evaluate endpoint prefers a posted `pipeline` over server config.
- Modify `admin/routes/pipelines.tsx`: replace the SSR route markup with the same workbench structure.
- Delete `admin/routes/playground.tsx`: no server-rendered Playground page remains.
- Modify `admin/static/pipelines.js`: integrate graph state, canvas rendering, editor interactions, inspector, YAML preview, and Test Run drawer.
- Delete `admin/static/playground.js`: move presets, evaluation, and result rendering into `pipelines.js`.
- Modify `admin/static/styles.css`: add workbench, canvas, inspector, drawer, minimap, selection, invalid, and execution highlight styles; remove unused standalone Playground layout rules only after the integrated drawer has replacement styles.
- Modify `admin/static/app.test.ts` only if asset routing expectations need cache-version assertion updates.

---

### Task 1: Pure Graph Conversion Module

**Files:**

- Create: `admin/static/pipeline_graph.js`
- Modify: `src/admin/pipelines-static.test.ts`

- [ ] **Step 1: Write failing tests for graph conversion and validation**

Add these imports near the top of `src/admin/pipelines-static.test.ts`:

```ts
import {
  graphToPipelines,
  matchExecutionSteps,
  pipelinesToGraph,
  validatePipelineGraph,
} from '../../admin/static/pipeline_graph.js';
```

Append these tests to `src/admin/pipelines-static.test.ts`:

```ts
Deno.test('pipeline graph converts linear client and server pipelines round trip', () => {
  const pipelines = {
    client: [
      { policy: 'kind-filter', config: { allow_kinds: [1] } },
      { policy: 'accept', config: {} },
    ],
    server: [{ policy: 'write-guard', config: { require_auth: true } }],
  };

  const graph = pipelinesToGraph(pipelines);

  assertEquals(graph.client.nodes.map((node: any) => node.policy), ['start', 'kind-filter', 'accept']);
  assertEquals(graph.client.edges.map((edge: any) => [edge.from, edge.to, edge.fromPort]), [
    ['client-start', 'client-node-1', 'next'],
    ['client-node-1', 'client-node-2', 'next'],
  ]);
  assertEquals(graphToPipelines(graph), pipelines);
});

Deno.test('pipeline graph preserves when branches as nested pipelines', () => {
  const pipelines = {
    client: [{
      policy: 'when',
      config: {
        condition: { authenticated: true },
        then: [{ policy: 'accept', config: {} }],
        else: [{ policy: 'rate-limit', config: { max_per_minute: 5 } }],
      },
    }],
    server: [],
  };

  const graph = pipelinesToGraph(pipelines);
  const clientEdges = graph.client.edges.map((edge: any) => [edge.from, edge.fromPort, edge.to]);

  assertEquals(clientEdges, [
    ['client-start', 'next', 'client-node-1'],
    ['client-node-1', 'then', 'client-node-2'],
    ['client-node-1', 'else', 'client-node-3'],
  ]);
  assertEquals(graphToPipelines(graph), pipelines);
});

Deno.test('pipeline graph validation rejects cycles and unsupported merges', () => {
  const graph = pipelinesToGraph({
    client: [{ policy: 'accept', config: {} }, { policy: 'rate-limit', config: { max_per_minute: 10 } }],
    server: [],
  });

  graph.client.edges.push({ id: 'cycle', from: 'client-node-2', fromPort: 'next', to: 'client-node-1', toPort: 'in' });
  const cycleResult = validatePipelineGraph(graph.client);
  assertEquals(cycleResult.valid, false);
  assertEquals(cycleResult.errors.some((error: any) => error.code === 'cycle'), true);

  const mergeGraph = pipelinesToGraph({
    client: [{
      policy: 'when',
      config: {
        condition: { authenticated: true },
        then: [{ policy: 'accept', config: {} }],
        else: [{ policy: 'rate-limit', config: { max_per_minute: 10 } }],
      },
    }],
    server: [],
  });
  mergeGraph.client.edges.push({
    id: 'unsupported-merge',
    from: 'client-node-3',
    fromPort: 'next',
    to: 'client-node-2',
    toPort: 'in',
  });

  const mergeResult = validatePipelineGraph(mergeGraph.client);
  assertEquals(mergeResult.valid, false);
  assertEquals(mergeResult.errors.some((error: any) => error.code === 'multiple-inputs'), true);
});

Deno.test('pipeline graph matches execution steps to graph nodes in order', () => {
  const graph = pipelinesToGraph({
    client: [
      { policy: 'accept', config: {} },
      { policy: 'accept', config: {} },
    ],
    server: [],
  });

  const matches = matchExecutionSteps(graph.client, [
    { policy: 'accept', action: 'next' },
    { policy: 'accept', action: 'accept' },
  ]);

  assertEquals(matches, [
    { stepIndex: 0, nodeId: 'client-node-1', action: 'next' },
    { stepIndex: 1, nodeId: 'client-node-2', action: 'accept' },
  ]);
});
```

- [ ] **Step 2: Run graph tests to verify they fail**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/pipelines-static.test.ts
```

Expected: FAIL with an import error for `../../admin/static/pipeline_graph.js`.

- [ ] **Step 3: Create `pipeline_graph.js` with pure graph helpers**

Create `admin/static/pipeline_graph.js` with these exports and behavior:

```js
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 64;
const HORIZONTAL_GAP = 240;
const VERTICAL_GAP = 120;

function cloneConfig(config) {
  return config && typeof config === 'object' ? JSON.parse(JSON.stringify(config)) : {};
}

function makeGraph(direction, entries = []) {
  const graph = {
    direction,
    nodes: [{
      id: `${direction}-start`,
      type: 'start',
      policy: 'start',
      config: {},
      x: 40,
      y: 120,
      width: 110,
      height: 48,
      path: [direction, 'start'],
    }],
    edges: [],
  };
  let nextIndex = 1;

  function addEntry(entry, depth, row, path) {
    const id = `${direction}-node-${nextIndex++}`;
    const node = {
      id,
      type: entry.policy === 'when' || entry.policy === 'match' ? 'branch' : 'policy',
      policy: entry.policy,
      config: cloneConfig(entry.config),
      x: 40 + depth * HORIZONTAL_GAP,
      y: 80 + row * VERTICAL_GAP,
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
      path,
    };
    graph.nodes.push(node);

    if (entry.policy === 'when') {
      const thenEntries = Array.isArray(entry.config?.then) ? entry.config.then : [];
      const elseEntries = Array.isArray(entry.config?.else) ? entry.config.else : [];
      const thenFirst = addEntries(thenEntries, id, 'then', depth + 1, row, [...path, 'config', 'then']);
      const elseFirst = addEntries(elseEntries, id, 'else', depth + 1, row + Math.max(1, thenEntries.length), [
        ...path,
        'config',
        'else',
      ]);
      if (!thenFirst && thenEntries.length === 0) node.emptyPorts = [...(node.emptyPorts ?? []), 'then'];
      if (!elseFirst && elseEntries.length === 0) node.emptyPorts = [...(node.emptyPorts ?? []), 'else'];
    }

    if (entry.policy === 'match') {
      const cases = Array.isArray(entry.config?.cases) ? entry.config.cases : [];
      let caseRow = row;
      cases.forEach((matchCase, caseIndex) => {
        const caseEntries = Array.isArray(matchCase.pipeline) ? matchCase.pipeline : [];
        const port = `case:${caseIndex}`;
        const first = addEntries(caseEntries, id, port, depth + 1, caseRow, [
          ...path,
          'config',
          'cases',
          String(caseIndex),
          'pipeline',
        ]);
        if (!first && caseEntries.length === 0) node.emptyPorts = [...(node.emptyPorts ?? []), port];
        caseRow += Math.max(1, caseEntries.length);
      });
      const defaultEntries = Array.isArray(entry.config?.default) ? entry.config.default : [];
      const first = addEntries(defaultEntries, id, 'default', depth + 1, caseRow, [...path, 'config', 'default']);
      if (!first && defaultEntries.length === 0) node.emptyPorts = [...(node.emptyPorts ?? []), 'default'];
    }

    return id;
  }

  function addEdge(from, fromPort, to) {
    graph.edges.push({ id: `${from}:${fromPort}->${to}`, from, fromPort, to, toPort: 'in' });
  }

  function addEntries(list, parentId, parentPort, depth, row, path) {
    let previous = parentId;
    let previousPort = parentPort;
    let first = null;
    list.forEach((entry, index) => {
      const nodeId = addEntry(entry, depth + index, row, [...path, String(index)]);
      addEdge(previous, previousPort, nodeId);
      if (!first) first = nodeId;
      previous = nodeId;
      previousPort = 'next';
    });
    return first;
  }

  addEntries(entries, `${direction}-start`, 'next', 1, 0, [direction]);
  return graph;
}

export function pipelinesToGraph(pipelines = {}) {
  return {
    client: makeGraph('client', pipelines.client ?? []),
    server: makeGraph('server', pipelines.server ?? []),
  };
}

function incomingByNode(graph) {
  const incoming = new Map();
  graph.edges.forEach((edge) => {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  });
  return incoming;
}

function outgoingByNode(graph) {
  const outgoing = new Map();
  graph.edges.forEach((edge) => {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  });
  return outgoing;
}

export function validatePipelineGraph(graph) {
  const errors = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const startNodes = graph.nodes.filter((node) => node.type === 'start');
  if (startNodes.length !== 1) {
    errors.push({ code: 'start-count', message: 'Graph must contain exactly one start node.' });
  }

  const incoming = incomingByNode(graph);
  incoming.forEach((edges, nodeId) => {
    if (edges.length > 1) {
      errors.push({ code: 'multiple-inputs', nodeId, message: 'Merging branches is not supported.' });
    }
  });

  graph.edges.forEach((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      errors.push({ code: 'dangling-edge', edgeId: edge.id, message: 'Edge points to a missing node.' });
    }
  });

  const outgoing = outgoingByNode(graph);
  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      errors.push({ code: 'cycle', nodeId, message: 'Cycles cannot be converted to pipeline config.' });
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.to);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  if (startNodes[0]) visit(startNodes[0].id);

  graph.nodes.forEach((node) => {
    if (node.type !== 'start' && !visited.has(node.id)) {
      errors.push({
        code: 'unreachable-node',
        nodeId: node.id,
        message: 'Only nodes reachable from start can be saved.',
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

function serializeChain(graph, startId, startPort) {
  const outgoing = outgoingByNode(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const result = [];
  let edge = (outgoing.get(startId) ?? []).find((candidate) => candidate.fromPort === startPort);
  const seen = new Set();
  while (edge) {
    if (seen.has(edge.to)) break;
    seen.add(edge.to);
    const node = nodeById.get(edge.to);
    if (!node || node.type === 'start') break;
    const config = cloneConfig(node.config);
    if (node.policy === 'when') {
      config.then = serializeChain(graph, node.id, 'then');
      config.else = serializeChain(graph, node.id, 'else');
    }
    if (node.policy === 'match') {
      const cases = Array.isArray(config.cases) ? config.cases : [];
      config.cases = cases.map((matchCase, index) => ({
        ...matchCase,
        pipeline: serializeChain(graph, node.id, `case:${index}`),
      }));
      config.default = serializeChain(graph, node.id, 'default');
    }
    result.push(Object.keys(config).length > 0 ? { policy: node.policy, config } : { policy: node.policy });
    edge = (outgoing.get(node.id) ?? []).find((candidate) => candidate.fromPort === 'next');
  }
  return result;
}

export function graphToPipelines(graphs) {
  return {
    client: serializeChain(graphs.client, 'client-start', 'next'),
    server: serializeChain(graphs.server, 'server-start', 'next'),
  };
}

export function orderedPolicyNodes(graph) {
  const order = [];
  function walk(startId, port) {
    const outgoing = outgoingByNode(graph);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    let edge = (outgoing.get(startId) ?? []).find((candidate) => candidate.fromPort === port);
    while (edge) {
      const node = nodeById.get(edge.to);
      if (!node || node.type === 'start') return;
      order.push(node);
      if (node.policy === 'when') {
        walk(node.id, 'then');
        walk(node.id, 'else');
      } else if (node.policy === 'match') {
        const cases = Array.isArray(node.config?.cases) ? node.config.cases : [];
        cases.forEach((_matchCase, index) => walk(node.id, `case:${index}`));
        walk(node.id, 'default');
      }
      edge = (outgoing.get(node.id) ?? []).find((candidate) => candidate.fromPort === 'next');
    }
  }
  walk(`${graph.direction}-start`, 'next');
  return order;
}

export function matchExecutionSteps(graph, steps = []) {
  const ordered = orderedPolicyNodes(graph);
  const used = new Set();
  return steps.map((step, stepIndex) => {
    const node = ordered.find((candidate, index) => !used.has(index) && candidate.policy === step.policy);
    if (!node) return { stepIndex, nodeId: null, action: step.action };
    const index = ordered.indexOf(node);
    used.add(index);
    return { stepIndex, nodeId: node.id, action: step.action };
  });
}
```

- [ ] **Step 4: Run graph tests to verify they pass**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/pipelines-static.test.ts
```

Expected: PASS for all tests in `src/admin/pipelines-static.test.ts`.

- [ ] **Step 5: Commit graph helpers**

```bash
git add admin/static/pipeline_graph.js src/admin/pipelines-static.test.ts
git commit -m "Add pipeline graph conversion helpers"
```

---

### Task 2: Evaluate Posted Workbench Pipeline

**Files:**

- Modify: `admin/api_routes.ts`
- Modify: `admin/api_routes.test.ts`

- [ ] **Step 1: Write failing API test for request-scoped pipeline evaluation**

Append this test to `admin/api_routes.test.ts`:

```ts
Deno.test('playground evaluate can use request pipeline instead of server config', async () => {
  const app = new RecordedRoutes();
  const state = makeState();
  registerAdminApiRoutes(app, '/admin', state);

  const res = await app.postRoutes.get('/admin/api/playground/evaluate')!(
    makeContext('/admin/api/playground/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: 'client',
        pipeline: [{ policy: 'kind-filter', config: { allow_kinds: [2] } }],
        message: ['EVENT', { kind: 1 }],
        connectionInfo: { authenticated: false, pubkey: '', clientIp: '127.0.0.1' },
      }),
    }),
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.finalAction, 'reject');
  assertEquals(body.steps[0].policy, 'kind-filter');
});
```

- [ ] **Step 2: Run API test to verify it fails**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/api_routes.test.ts
```

Expected: FAIL because the endpoint ignores `body.pipeline` and evaluates the state config `{ policy: 'accept' }`.

- [ ] **Step 3: Extend evaluate endpoint to prefer a posted pipeline**

In `admin/api_routes.ts`, replace the pipeline selection inside `/api/playground/evaluate` with:

```ts
const postedPipeline = Array.isArray(body.pipeline) ? body.pipeline : null;
const pipeline = postedPipeline ??
  (direction === 'server' ? (state.config.pipelines?.server ?? []) : (state.config.pipelines?.client ?? []));
```

Keep the existing `message` array validation and `simulatePipeline(pipeline, message, connectionInfo)` call.

- [ ] **Step 4: Run API test to verify it passes**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/api_routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit evaluate override**

```bash
git add admin/api_routes.ts admin/api_routes.test.ts
git commit -m "Allow workbench test runs to post pipelines"
```

---

### Task 3: Remove Standalone Playground Routing

**Files:**

- Modify: `admin/components/Sidebar.tsx`
- Modify: `admin/page_routes.ts`
- Modify: `admin/static/page_templates.js`
- Modify: `admin/static/page_templates.test.ts`
- Modify: `admin/page_routes.test.ts`
- Modify: `admin/main.test.ts`
- Delete: `admin/routes/playground.tsx`

- [ ] **Step 1: Write failing routing tests**

Update `admin/static/page_templates.test.ts` expected route list to remove `/admin/playground`, and add this assertion:

```ts
assertEquals(routes['/admin/pipelines'].module, '/admin/static/pipelines.js');
assertEquals(routes['/admin/playground'], undefined);
```

Update `admin/page_routes.test.ts` after existing route assertions:

```ts
assertEquals(app.getRoutes.has('/admin/playground'), false);
```

Append this test to `admin/main.test.ts`:

```ts
Deno.test('admin app does not keep standalone playground page route', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/playground', 'test-token'));

  assertEquals(res.status, 404);
});
```

- [ ] **Step 2: Run routing tests to verify they fail**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/page_templates.test.ts admin/page_routes.test.ts admin/main.test.ts
```

Expected: FAIL because `/admin/playground` is still present.

- [ ] **Step 3: Remove Playground from nav and route registrations**

In `admin/components/Sidebar.tsx`, remove this item from `NAV_ITEMS`:

```tsx
{ href: '/admin/playground', label: 'Playground', icon: '▷' },
```

In `admin/page_routes.ts`, remove `'/playground'` from `SPA_PAGE_PATHS`.

In `admin/static/page_templates.js`, remove this route entry from `createPageRoutes()`:

```js
'/admin/playground': {
  title: 'Playground',
  render: renderPlaygroundPage,
  module: '/admin/static/playground.js',
  init: 'initPlaygroundPage',
},
```

Then delete the entire `renderPlaygroundPage(root)` export from `admin/static/page_templates.js`.

Delete `admin/routes/playground.tsx`.

- [ ] **Step 4: Run routing tests to verify they pass**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/page_templates.test.ts admin/page_routes.test.ts admin/main.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit route removal**

```bash
git add admin/components/Sidebar.tsx admin/page_routes.ts admin/static/page_templates.js admin/static/page_templates.test.ts admin/page_routes.test.ts admin/main.test.ts
git add -u admin/routes/playground.tsx
git commit -m "Remove standalone playground page"
```

---

### Task 4: Replace Pipeline Page Markup With Workbench Shell

**Files:**

- Modify: `admin/static/page_templates.js`
- Modify: `admin/routes/pipelines.tsx`
- Modify: `admin/static/page_templates.test.ts`

- [ ] **Step 1: Write failing template tests for the workbench shell**

Append this test to `admin/static/page_templates.test.ts`:

```ts
Deno.test('pipelines template contains integrated workbench shell ids', async () => {
  const source = await Deno.readTextFile(new URL('./page_templates.js', import.meta.url));

  assertEquals(source.includes("id: 'pipeline-workbench'"), true);
  assertEquals(source.includes("id: 'pipeline-canvas'"), true);
  assertEquals(source.includes("id: 'policy-palette'"), true);
  assertEquals(source.includes("id: 'node-inspector'"), true);
  assertEquals(source.includes("id: 'test-run-drawer'"), true);
  assertEquals(source.includes("id: 'result-panel'"), true);
});
```

- [ ] **Step 2: Run template test to verify it fails**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/page_templates.test.ts
```

Expected: FAIL because the current pipelines page has `#pipeline-tree-container` instead of `#pipeline-workbench`.

- [ ] **Step 3: Update SPA page template workbench DOM**

Replace `renderPipelinesPage(root)` in `admin/static/page_templates.js` with this structure:

```js
export function renderPipelinesPage(root) {
  root.replaceChildren(
    el('div', { className: 'pipeline-workbench', id: 'pipeline-workbench' }, [
      pageHeader('Pipelines', [
        button('Client', 'btn btn-primary pipeline-mode-tab', {
          id: 'tab-client',
          dataset: { pipeline: 'client' },
        }),
        button('Server', 'btn btn-ghost pipeline-mode-tab', {
          id: 'tab-server',
          dataset: { pipeline: 'server' },
        }),
        button('↺ Refresh', 'btn btn-ghost', { id: 'btn-refresh-pipelines' }),
        button('⛶ Fit', 'btn btn-ghost', { id: 'btn-fit-canvas' }),
        button('−', 'btn btn-ghost', { id: 'btn-zoom-out', title: 'Zoom out' }),
        button('+', 'btn btn-ghost', { id: 'btn-zoom-in', title: 'Zoom in' }),
        button('▷ Run', 'btn btn-ghost', { id: 'btn-run-toolbar' }),
        button('✓ Apply Config', 'btn btn-primary', { id: 'btn-apply-pipeline' }),
      ], el('span', { className: 'text-muted', id: 'workbench-status-summary' }, ['Ready'])),
      el('div', { id: 'pipeline-status', className: 'workbench-status' }),
      el('div', { className: 'workbench-grid' }, [
        el('aside', { className: 'workbench-panel palette-panel' }, [
          el('div', { className: 'workbench-panel-header' }, ['Policy Palette']),
          el('div', { className: 'workbench-panel-body policy-palette', id: 'policy-palette' }, [
            el('div', { className: 'pipeline-empty' }, ['Loading policies...']),
          ]),
        ]),
        el('section', { className: 'canvas-shell' }, [
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
        el('aside', { className: 'workbench-panel inspector-panel' }, [
          el('div', { className: 'workbench-panel-header' }, ['Inspector']),
          el('div', { className: 'workbench-panel-body node-inspector', id: 'node-inspector' }, [
            el('div', { className: 'pipeline-empty' }, ['Select a node to edit its config.']),
          ]),
        ]),
      ]),
      el('section', { className: 'test-run-drawer collapsed', id: 'test-run-drawer' }, [
        el('button', { type: 'button', className: 'drawer-toggle', id: 'btn-toggle-test-run' }, [
          el('span', {}, ['Test Run']),
          el('span', { className: 'text-muted', id: 'test-run-summary' }, ['No run yet']),
        ]),
        el('div', { className: 'drawer-content' }, [
          el('div', { className: 'test-run-inputs' }, [
            el('div', {}, [
              el('div', { className: 'section-title' }, ['Presets']),
              el('div', { className: 'preset-buttons', id: 'preset-buttons' }),
            ]),
            el('label', { className: 'section-title', htmlFor: 'message-input' }, ['Message JSON']),
            el('textarea', {
              id: 'message-input',
              className: 'message-textarea',
              spellcheck: false,
              placeholder: '["EVENT", {...}]',
            }),
            el('div', { className: 'context-grid' }, [
              el('label', { className: 'context-label', htmlFor: 'ctx-authenticated' }, ['Authenticated']),
              el('input', { type: 'checkbox', id: 'ctx-authenticated' }),
              el('label', { className: 'context-label', htmlFor: 'ctx-pubkey' }, ['Pubkey']),
              el('input', { type: 'text', id: 'ctx-pubkey', className: 'context-input', placeholder: '(hex pubkey)' }),
              el('label', { className: 'context-label', htmlFor: 'ctx-ip' }, ['Client IP']),
              el('input', {
                type: 'text',
                id: 'ctx-ip',
                className: 'context-input',
                placeholder: '127.0.0.1',
                value: '127.0.0.1',
              }),
            ]),
            button('▷ Run', 'btn btn-primary', { id: 'btn-run' }),
          ]),
          el('div', { className: 'test-run-results' }, [
            el('div', { className: 'workbench-panel-header' }, ['Execution Result']),
            el('div', { className: 'playground-panel-body', id: 'result-panel' }, [
              el('div', { className: 'playground-empty', id: 'result-empty' }, [
                'Enter a message and run it against the selected pipeline.',
              ]),
            ]),
          ]),
          el('div', { className: 'yaml-drawer-panel' }, [
            el('div', { className: 'workbench-panel-header' }, ['YAML Preview']),
            el('pre', { className: 'yaml-preview', id: 'yaml-preview' }, ['Loading...']),
          ]),
        ]),
      ]),
    ]),
  );
}
```

- [ ] **Step 4: Update SSR pipelines page with matching IDs**

In `admin/routes/pipelines.tsx`, replace the current two-column layout markup with the same IDs and class names from Step 3. Preact syntax must use `class` and nested JSX instead of `el(...)`. Preserve:

```tsx
<script src='/admin/static/utils.js'></script>
<script src='/admin/static/pipelines.js' type='module'></script>
```

at the end of the layout.

- [ ] **Step 5: Run template tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/page_templates.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit workbench shell**

```bash
git add admin/static/page_templates.js admin/routes/pipelines.tsx admin/static/page_templates.test.ts
git commit -m "Render integrated pipeline workbench shell"
```

---

### Task 5: Workbench Styles

**Files:**

- Modify: `admin/static/styles.css`

- [ ] **Step 1: Add layout and graph styles**

Append these styles to `admin/static/styles.css` after the existing Pipeline / Playground styles, then remove duplicate old `.pipelines-layout` and `.playground-layout` rules only if they conflict visually with the new classes:

```css
.pipeline-workbench {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100vh - 48px);
}

.workbench-status {
  min-height: 28px;
}

.workbench-grid {
  display: grid;
  grid-template-columns: 220px minmax(420px, 1fr) 300px;
  gap: 12px;
  min-height: 560px;
  height: calc(100vh - 240px);
}

.workbench-panel,
.canvas-shell,
.test-run-drawer {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.workbench-panel {
  display: flex;
  flex-direction: column;
}

.workbench-panel-header,
.canvas-toolbar {
  min-height: 40px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}

.workbench-panel-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
}

.policy-palette {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.policy-palette-item {
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-text);
  padding: 9px 10px;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.policy-palette-item:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.canvas-shell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pipeline-canvas {
  position: relative;
  flex: 1;
  min-height: 420px;
  overflow: hidden;
  background-color: var(--color-bg);
  background-image:
    linear-gradient(var(--color-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-border) 1px, transparent 1px);
  background-size: 24px 24px;
  outline: none;
  cursor: grab;
}

.pipeline-canvas.dragging {
  cursor: grabbing;
}

.pipeline-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.graph-edge {
  fill: none;
  stroke: var(--color-border);
  stroke-width: 2;
}

.graph-edge.selected,
.graph-edge.executed {
  stroke: var(--color-accent);
  stroke-width: 3;
}

.graph-edge.reject {
  stroke: var(--color-danger);
}

.graph-edge.accept {
  stroke: var(--color-success);
}

.graph-node rect {
  fill: var(--color-surface);
  stroke: var(--color-border);
  stroke-width: 1.5;
  rx: 8;
}

.graph-node.selected rect {
  stroke: var(--color-accent);
  stroke-width: 2.5;
}

.graph-node.invalid rect {
  stroke: var(--color-danger);
}

.graph-node.executed rect {
  stroke: var(--color-success);
  stroke-width: 2.5;
}

.graph-node text {
  fill: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
}

.graph-node .node-subtitle {
  fill: var(--color-text-muted);
  font-size: 11px;
  font-weight: 400;
}

.graph-port {
  fill: var(--color-surface);
  stroke: var(--color-accent);
  stroke-width: 2;
  cursor: crosshair;
}

.selection-marquee {
  position: absolute;
  display: none;
  border: 1px dashed var(--color-accent);
  background: rgba(76, 110, 245, 0.08);
  pointer-events: none;
}

.canvas-minimap {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 160px;
  height: 110px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-surface);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
}

.minimap-svg {
  width: 100%;
  height: 100%;
}

.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.inspector-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.inspector-field label {
  font-size: 12px;
  color: var(--color-text-muted);
  font-weight: 600;
}

.test-run-drawer {
  flex-shrink: 0;
}

.drawer-toggle {
  width: 100%;
  min-height: 42px;
  border: 0;
  background: var(--color-surface-2);
  color: var(--color-text);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.drawer-content {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(280px, 1fr) minmax(260px, 0.8fr);
  gap: 12px;
  padding: 12px;
  max-height: 320px;
}

.test-run-drawer.collapsed .drawer-content {
  display: none;
}

.test-run-inputs,
.test-run-results,
.yaml-drawer-panel {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.yaml-drawer-panel .yaml-preview {
  min-height: 0;
  flex: 1;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

@media (max-width: 1100px) {
  .workbench-grid {
    grid-template-columns: 1fr;
    height: auto;
  }

  .workbench-panel,
  .canvas-shell {
    min-height: 260px;
  }

  .drawer-content {
    grid-template-columns: 1fr;
    max-height: none;
  }
}
```

- [ ] **Step 2: Run formatter**

Run:

```bash
deno fmt admin/static/styles.css
```

Expected: `admin/static/styles.css` is formatted without errors.

- [ ] **Step 3: Commit styles**

```bash
git add admin/static/styles.css
git commit -m "Style pipeline workbench shell"
```

---

### Task 6: Integrate Graph State, Palette, Inspector, and YAML Preview

**Files:**

- Modify: `admin/static/pipelines.js`

- [ ] **Step 1: Add graph imports and state**

At the top of `admin/static/pipelines.js`, add:

```js
import { graphToPipelines, pipelinesToGraph, validatePipelineGraph } from './pipeline_graph.js';
```

Replace the old tree editor globals with:

```js
let currentDirection = 'client';
let graphs = pipelinesToGraph({ client: [], server: [] });
let availablePlugins = [];
let selectedNodeIds = new Set();
let selectedEdgeId = null;
let invalidGraph = { valid: true, errors: [] };
const viewport = { x: 0, y: 0, scale: 1 };
let dragState = null;
let connecting = null;
let lastRunMatches = [];
```

Keep `buildYamlPreview` and `defaultConfigForPolicy` exports intact.

- [ ] **Step 2: Remove old tree-editor-only functions**

In `admin/static/pipelines.js`, remove the old visual tree functions and their references:

```js
renderEntry;
renderEntries;
moveEntry;
populatePluginSelect;
expandedEntries;
pipeline - tree - container;
add - policy - select;
btn - add - policy;
tree - panel - title;
```

The page must no longer query or render `#pipeline-tree-container`; the only pipeline editor surface after this task is `#pipeline-canvas`, `#policy-palette`, `#node-inspector`, and `#yaml-preview`.

- [ ] **Step 3: Replace pipeline array rendering with graph-backed render**

Add these helper functions to `admin/static/pipelines.js` after `defaultConfigForPolicy`:

```js
function currentGraph() {
  return graphs[currentDirection];
}

function syncPipelinesFromGraph() {
  const validation = validatePipelineGraph(currentGraph());
  invalidGraph = validation;
  if (!validation.valid) return null;
  return graphToPipelines(graphs);
}

function renderYamlPreview() {
  const yamlEl = document.getElementById('yaml-preview');
  if (!yamlEl) return;
  const converted = syncPipelinesFromGraph();
  yamlEl.textContent = converted
    ? buildYamlPreview(converted)
    : 'Graph is invalid. Fix the highlighted nodes or edges.';
}

function renderValidationStatus() {
  const status = document.getElementById('workbench-status-summary');
  if (status) {
    status.textContent = invalidGraph.valid ? 'Valid graph' : `${invalidGraph.errors.length} graph issue(s)`;
  }
  const detail = document.getElementById('pipeline-status');
  if (!detail) return;
  detail.replaceChildren();
  if (invalidGraph.valid) return;
  invalidGraph.errors.forEach((error) => {
    const row = document.createElement('div');
    row.className = 'playground-error';
    row.textContent = error.message;
    detail.appendChild(row);
  });
}

function renderPalette() {
  const palette = document.getElementById('policy-palette');
  if (!palette) return;
  palette.replaceChildren();
  availablePlugins.forEach((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'policy-palette-item';
    button.textContent = name;
    button.addEventListener('click', () => addPolicyNode(name));
    palette.appendChild(button);
  });
  if (availablePlugins.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pipeline-empty';
    empty.textContent = 'No policies available.';
    palette.appendChild(empty);
  }
}

function renderInspector() {
  const inspector = document.getElementById('node-inspector');
  if (!inspector) return;
  inspector.replaceChildren();
  const graph = currentGraph();
  const selected = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
  if (selected.length !== 1) {
    const empty = document.createElement('div');
    empty.className = 'pipeline-empty';
    empty.textContent = selected.length > 1
      ? `${selected.length} nodes selected.`
      : 'Select a node to edit its config.';
    inspector.appendChild(empty);
    return;
  }
  const node = selected[0];
  const title = document.createElement('div');
  title.className = 'pipeline-entry-name';
  title.textContent = node.policy;
  inspector.appendChild(title);

  const field = document.createElement('div');
  field.className = 'inspector-field';
  const label = document.createElement('label');
  label.htmlFor = 'inspector-config';
  label.textContent = 'Config JSON';
  const textarea = document.createElement('textarea');
  textarea.id = 'inspector-config';
  textarea.className = 'config-editor-textarea';
  textarea.value = JSON.stringify(node.config ?? {}, null, 2);
  textarea.disabled = node.type === 'start';
  textarea.addEventListener('change', () => {
    try {
      node.config = textarea.value.trim() ? JSON.parse(textarea.value) : {};
      render();
      setStatus('Updated ' + node.policy, false);
    } catch (error) {
      setStatus('Config parse error: ' + error.message, true);
    }
  });
  field.appendChild(label);
  field.appendChild(textarea);
  inspector.appendChild(field);
}
```

- [ ] **Step 4: Add node creation and graph render entry point**

Add these functions:

```js
function nextNodeId(graph) {
  let index = graph.nodes.length + 1;
  let id = `${graph.direction}-node-${index}`;
  while (graph.nodes.some((node) => node.id === id)) {
    index += 1;
    id = `${graph.direction}-node-${index}`;
  }
  return id;
}

function addPolicyNode(policyName) {
  const graph = currentGraph();
  const id = nextNodeId(graph);
  graph.nodes.push({
    id,
    type: policyName === 'when' || policyName === 'match' ? 'branch' : 'policy',
    policy: policyName,
    config: defaultConfigForPolicy(policyName),
    x: -viewport.x / viewport.scale + 180,
    y: -viewport.y / viewport.scale + 120,
    width: 160,
    height: 64,
    path: [currentDirection, id],
  });
  selectedNodeIds = new Set([id]);
  render();
  setStatus('Added ' + policyName, false);
}

function render() {
  invalidGraph = validatePipelineGraph(currentGraph());
  renderCanvas();
  renderPalette();
  renderInspector();
  renderYamlPreview();
  renderValidationStatus();
  const title = document.getElementById('canvas-title');
  if (title) title.textContent = currentDirection === 'client' ? 'Client Pipeline' : 'Server Pipeline';
  const zoom = document.getElementById('canvas-zoom-label');
  if (zoom) zoom.textContent = Math.round(viewport.scale * 100) + '%';
}
```

- [ ] **Step 5: Update config loading to initialize graphs**

In `loadPipelinesPage()`, replace direct assignments to `pipelines.client` / `pipelines.server` with:

```js
graphs = pipelinesToGraph({
  client: configData.pipelines?.client ?? [],
  server: configData.pipelines?.server ?? [],
});
availablePlugins = pluginsData.plugins ?? [];
selectedNodeIds = new Set();
selectedEdgeId = null;
render();
```

In `applyConfig()`, before calling reload, block invalid graph:

```js
const converted = syncPipelinesFromGraph();
if (!converted) {
  render();
  setStatus('Fix graph validation errors before applying config.', true);
  return;
}
```

Keep the existing reload request behavior after this guard.

- [ ] **Step 6: Commit graph-backed page state**

```bash
git add admin/static/pipelines.js
git commit -m "Connect pipeline workbench to graph state"
```

---

### Task 7: Canvas Rendering and Editor Interactions

**Files:**

- Modify: `admin/static/pipelines.js`

- [ ] **Step 1: Implement SVG rendering**

Add these functions before `render()` in `admin/static/pipelines.js`:

```js
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  });
  return node;
}

function nodeCenter(node, side) {
  if (side === 'left') return { x: node.x, y: node.y + node.height / 2 };
  return { x: node.x + node.width, y: node.y + node.height / 2 };
}

function edgePath(fromNode, toNode) {
  const from = nodeCenter(fromNode, 'right');
  const to = nodeCenter(toNode, 'left');
  const dx = Math.max(80, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

function renderCanvas() {
  const svg = document.getElementById('pipeline-svg');
  if (!svg) return;
  svg.replaceChildren();
  const graph = currentGraph();
  const group = svgEl('g', { transform: `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})` });
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  graph.edges.forEach((edge) => {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) return;
    const path = svgEl('path', {
      d: edgePath(fromNode, toNode),
      class: [
        'graph-edge',
        selectedEdgeId === edge.id ? 'selected' : '',
        lastRunMatches.some((match) => match.nodeId === edge.to) ? 'executed' : '',
      ].filter(Boolean).join(' '),
      'data-edge-id': edge.id,
    });
    path.addEventListener('click', (event) => {
      event.stopPropagation();
      selectedEdgeId = edge.id;
      selectedNodeIds = new Set();
      render();
    });
    group.appendChild(path);
  });

  graph.nodes.forEach((node) => {
    const nodeGroup = svgEl('g', {
      class: [
        'graph-node',
        selectedNodeIds.has(node.id) ? 'selected' : '',
        invalidGraph.errors.some((error) => error.nodeId === node.id) ? 'invalid' : '',
        lastRunMatches.some((match) => match.nodeId === node.id) ? 'executed' : '',
      ].filter(Boolean).join(' '),
      transform: `translate(${node.x} ${node.y})`,
      'data-node-id': node.id,
    });
    nodeGroup.appendChild(svgEl('rect', { width: node.width, height: node.height }));
    const title = svgEl('text', { x: 14, y: 26 });
    title.textContent = node.policy;
    nodeGroup.appendChild(title);
    const subtitle = svgEl('text', { x: 14, y: 46, class: 'node-subtitle' });
    subtitle.textContent = node.type === 'start' ? 'pipeline input' : condensedConfig(node);
    nodeGroup.appendChild(subtitle);
    const input = svgEl('circle', { class: 'graph-port', cx: 0, cy: node.height / 2, r: 5, 'data-port': 'in' });
    nodeGroup.appendChild(input);
    const next = svgEl('circle', {
      class: 'graph-port',
      cx: node.width,
      cy: node.height / 2,
      r: 5,
      'data-port': 'next',
    });
    nodeGroup.appendChild(next);
    nodeGroup.addEventListener('pointerdown', (event) => beginNodePointer(event, node));
    group.appendChild(nodeGroup);
  });

  svg.appendChild(group);
  renderMinimap();
}
```

- [ ] **Step 2: Implement selection, drag, pan, and keyboard deletion**

Add these functions:

```js
function canvasPoint(event) {
  const canvas = document.getElementById('pipeline-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - viewport.x) / viewport.scale,
    y: (event.clientY - rect.top - viewport.y) / viewport.scale,
    screenX: event.clientX - rect.left,
    screenY: event.clientY - rect.top,
  };
}

function beginNodePointer(event, node) {
  event.preventDefault();
  event.stopPropagation();
  const point = canvasPoint(event);
  if (!event.shiftKey && !selectedNodeIds.has(node.id)) selectedNodeIds = new Set([node.id]);
  if (event.shiftKey) {
    const next = new Set(selectedNodeIds);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    selectedNodeIds = next;
  }
  dragState = {
    type: 'node',
    start: point,
    nodeStarts: currentGraph().nodes
      .filter((candidate) => selectedNodeIds.has(candidate.id))
      .map((candidate) => ({ id: candidate.id, x: candidate.x, y: candidate.y })),
  };
  render();
}

function bindCanvasControls() {
  const canvas = document.getElementById('pipeline-canvas');
  if (!canvas) return;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('.graph-node')) return;
    canvas.focus();
    const point = canvasPoint(event);
    dragState = event.shiftKey
      ? { type: 'marquee', start: point, current: point }
      : { type: 'pan', start: point, viewportStart: { x: viewport.x, y: viewport.y } };
    selectedNodeIds = new Set();
    selectedEdgeId = null;
    render();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const point = canvasPoint(event);
    if (dragState.type === 'pan') {
      viewport.x = dragState.viewportStart.x + (point.screenX - dragState.start.screenX);
      viewport.y = dragState.viewportStart.y + (point.screenY - dragState.start.screenY);
    }
    if (dragState.type === 'node') {
      const dx = point.x - dragState.start.x;
      const dy = point.y - dragState.start.y;
      const graph = currentGraph();
      dragState.nodeStarts.forEach((start) => {
        const node = graph.nodes.find((candidate) => candidate.id === start.id);
        if (node && node.type !== 'start') {
          node.x = start.x + dx;
          node.y = start.y + dy;
        }
      });
    }
    if (dragState.type === 'marquee') {
      dragState.current = point;
      updateMarquee();
    }
    render();
  });
  canvas.addEventListener('pointerup', () => {
    if (dragState?.type === 'marquee') selectNodesInMarquee();
    dragState = null;
    updateMarquee();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    viewport.scale = Math.min(2, Math.max(0.35, viewport.scale + delta));
    render();
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      selectedNodeIds = new Set();
      selectedEdgeId = null;
      render();
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelection();
    }
  });
}

function deleteSelection() {
  const graph = currentGraph();
  graph.nodes = graph.nodes.filter((node) => node.type === 'start' || !selectedNodeIds.has(node.id));
  graph.edges = graph.edges.filter((edge) =>
    !selectedNodeIds.has(edge.from) && !selectedNodeIds.has(edge.to) && edge.id !== selectedEdgeId
  );
  selectedNodeIds = new Set();
  selectedEdgeId = null;
  render();
}

function updateMarquee() {
  const marquee = document.getElementById('selection-marquee');
  if (!marquee || dragState?.type !== 'marquee') {
    if (marquee) marquee.style.display = 'none';
    return;
  }
  const left = Math.min(dragState.start.screenX, dragState.current.screenX);
  const top = Math.min(dragState.start.screenY, dragState.current.screenY);
  const width = Math.abs(dragState.current.screenX - dragState.start.screenX);
  const height = Math.abs(dragState.current.screenY - dragState.start.screenY);
  marquee.style.display = 'block';
  marquee.style.left = left + 'px';
  marquee.style.top = top + 'px';
  marquee.style.width = width + 'px';
  marquee.style.height = height + 'px';
}

function selectNodesInMarquee() {
  const minX = Math.min(dragState.start.x, dragState.current.x);
  const minY = Math.min(dragState.start.y, dragState.current.y);
  const maxX = Math.max(dragState.start.x, dragState.current.x);
  const maxY = Math.max(dragState.start.y, dragState.current.y);
  selectedNodeIds = new Set(
    currentGraph().nodes
      .filter((node) =>
        node.type !== 'start' &&
        node.x >= minX &&
        node.y >= minY &&
        node.x + node.width <= maxX &&
        node.y + node.height <= maxY
      )
      .map((node) => node.id),
  );
}
```

- [ ] **Step 3: Implement connection editing, fit, zoom buttons, and minimap**

Use port pointer events inside `renderCanvas()`. Replace the simple input / next port creation from Step 1 with this port code:

```js
const input = svgEl('circle', { class: 'graph-port', cx: 0, cy: node.height / 2, r: 5, 'data-port': 'in' });
input.addEventListener('pointerup', (event) => {
  event.stopPropagation();
  if (connecting && node.type !== 'start') {
    connectNodes(connecting.from, connecting.fromPort, node.id);
  }
  connecting = null;
});
nodeGroup.appendChild(input);

function appendOutputPort(portName, y) {
  const port = svgEl('circle', {
    class: 'graph-port',
    cx: node.width,
    cy: y,
    r: 5,
    'data-port': portName,
  });
  port.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    connecting = { from: node.id, fromPort: portName };
  });
  nodeGroup.appendChild(port);
}

appendOutputPort('next', node.height / 2);
if (node.policy === 'when') {
  appendOutputPort('then', 20);
  appendOutputPort('else', node.height - 20);
}
if (node.policy === 'match') {
  const cases = Array.isArray(node.config?.cases) ? node.config.cases : [];
  cases.forEach((_matchCase, index) => appendOutputPort(`case:${index}`, 18 + index * 16));
  appendOutputPort('default', node.height - 18);
}
```

Then add the connection helper:

```js
function connectNodes(from, fromPort, to) {
  const graph = currentGraph();
  if (from === to) {
    setStatus('Cannot connect a node to itself.', true);
    return;
  }
  graph.edges = graph.edges.filter((edge) => !(edge.from === from && edge.fromPort === fromPort));
  graph.edges.push({ id: `${from}:${fromPort}->${to}`, from, fromPort, to, toPort: 'in' });
  render();
}

function fitCanvas() {
  const graph = currentGraph();
  const canvas = document.getElementById('pipeline-canvas');
  if (!canvas || graph.nodes.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const minX = Math.min(...graph.nodes.map((node) => node.x));
  const minY = Math.min(...graph.nodes.map((node) => node.y));
  const maxX = Math.max(...graph.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...graph.nodes.map((node) => node.y + node.height));
  const scale = Math.min(
    1.4,
    Math.max(0.35, Math.min(rect.width / (maxX - minX + 160), rect.height / (maxY - minY + 160))),
  );
  viewport.scale = scale;
  viewport.x = 80 - minX * scale;
  viewport.y = 80 - minY * scale;
  render();
}

function renderMinimap() {
  const svg = document.getElementById('minimap-svg');
  if (!svg) return;
  svg.replaceChildren();
  const graph = currentGraph();
  graph.nodes.forEach((node) => {
    svg.appendChild(svgEl('rect', {
      x: node.x / 6 + 12,
      y: node.y / 6 + 12,
      width: Math.max(10, node.width / 6),
      height: Math.max(8, node.height / 6),
      fill: selectedNodeIds.has(node.id) ? 'var(--color-accent)' : 'var(--color-border)',
      rx: 2,
    }));
  });
}
```

Bind `#btn-fit-canvas`, `#btn-zoom-in`, and `#btn-zoom-out` in `bindPipelineControls()`.

- [ ] **Step 4: Run static graph tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/pipelines-static.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit canvas interactions**

```bash
git add admin/static/pipelines.js
git commit -m "Add pipeline canvas interactions"
```

---

### Task 8: Integrate Test Run Drawer and Execution Highlight

**Files:**

- Modify: `admin/static/pipelines.js`
- Delete: `admin/static/playground.js`

- [ ] **Step 1: Move presets and result rendering into `pipelines.js`**

Copy `PRESETS`, `circleChar`, `makeStepItem`, `renderResults`, `renderError`, and `runEvaluation` from `admin/static/playground.js` into `admin/static/pipelines.js`. Change `renderResults(data)` so it also updates graph highlights:

```js
import { matchExecutionSteps } from './pipeline_graph.js';
```

Merge this import with the existing graph import.

At the end of `renderResults(data)`, add:

```js
lastRunMatches = matchExecutionSteps(currentGraph(), data.steps);
const summary = document.getElementById('test-run-summary');
if (summary) summary.textContent = 'Final: ' + String(data.finalAction ?? 'unknown').toUpperCase();
render();
```

In `runEvaluation()`, keep the request body shape:

```js
const converted = syncPipelinesFromGraph();
if (!converted) {
  renderError('Fix graph validation errors before running a test.');
  render();
  return;
}

body: JSON.stringify({
  message,
  direction: currentDirection,
  pipeline: converted[currentDirection],
  connectionInfo: { authenticated, pubkey, clientIp },
}),
```

- [ ] **Step 2: Bind drawer, presets, toolbar run, and textarea shortcut**

Add this function to `pipelines.js`:

```js
function bindTestRunControls() {
  const drawer = document.getElementById('test-run-drawer');
  const toggle = document.getElementById('btn-toggle-test-run');
  if (toggle && drawer) {
    toggle.addEventListener('click', () => drawer.classList.toggle('collapsed'));
  }

  const presetWrap = document.getElementById('preset-buttons');
  if (presetWrap && presetWrap.children.length === 0) {
    Object.keys(PRESETS).forEach((key) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.dataset.preset = key;
      btn.textContent = key;
      btn.addEventListener('click', () => {
        const textarea = document.getElementById('message-input');
        if (textarea) textarea.value = PRESETS[key];
      });
      presetWrap.appendChild(btn);
    });
  }

  const btnRun = document.getElementById('btn-run');
  if (btnRun) btnRun.addEventListener('click', runEvaluation);
  const toolbarRun = document.getElementById('btn-run-toolbar');
  if (toolbarRun) {
    toolbarRun.addEventListener('click', () => {
      drawer?.classList.remove('collapsed');
      runEvaluation();
    });
  }
  const textarea = document.getElementById('message-input');
  if (textarea) {
    textarea.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 'Enter') runEvaluation();
    });
  }
}
```

Call `bindTestRunControls()` from `initPipelinesPage()`.

- [ ] **Step 3: Delete standalone playground module**

Delete `admin/static/playground.js`.

Verify no route imports it:

```bash
rg -n "playground\\.js|initPlaygroundPage|renderPlaygroundPage" admin src
```

Expected: no output.

- [ ] **Step 4: Run tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/ src/admin/pipelines-static.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Test Run integration**

```bash
git add admin/static/pipelines.js
git add -u admin/static/playground.js
git commit -m "Integrate test run drawer into pipelines"
```

---

### Task 9: Final Verification and Manual QA

**Files:**

- Modify only if verification finds defects in prior task files.

- [ ] **Step 1: Run full tests**

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/ src/
```

Expected: PASS.

- [ ] **Step 2: Run formatter**

Run:

```bash
deno fmt admin src docs/superpowers/specs/2026-06-10-pipeline-playground-workbench-design.md docs/superpowers/plans/2026-06-10-pipeline-playground-workbench.md
```

Expected: no formatting errors.

- [ ] **Step 3: Start dev server**

Run:

```bash
deno task dev
```

Expected: local admin server starts. If the command fails because port 3000 is already in use, use the port already configured by the running process and do not kill unrelated services.

- [ ] **Step 4: Browser QA on `/admin/pipelines`**

Open `/admin/pipelines` with a valid admin token/session and verify:

- Sidebar no longer shows `Playground`.
- `/admin/playground` returns not found.
- Client / Server tabs switch graph content.
- Policy palette adds nodes.
- Node drag, pan, wheel zoom, Fit, zoom buttons, selection, multi-selection, Delete, Escape, and minimap work.
- Connecting an unsupported merge shows validation errors and blocks YAML update.
- Inspector JSON edit changes the selected node config and YAML preview.
- Test Run drawer opens, presets fill message JSON, Ctrl+Enter runs, and result steps render.
- Run highlights matching graph nodes in execution order.
- At mobile width, the workbench stacks without clipped controls.

- [ ] **Step 5: Fix any QA defects and rerun focused tests**

For each defect, make the smallest change in the touched file and run the most specific command:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/pipelines-static.test.ts
```

for graph defects, or:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/static/page_templates.test.ts admin/page_routes.test.ts admin/main.test.ts
```

for route/template defects.

- [ ] **Step 6: Commit final QA fixes**

If Step 5 changed files:

```bash
git add admin src
git commit -m "Polish pipeline workbench QA issues"
```

If Step 5 changed no files, skip this commit.

---

## Self-Review Checklist

- Spec coverage: Tasks 3 and 4 cover page integration and `/admin/playground` removal; Tasks 1, 6, and 7 cover graph conversion and editor operations; Task 2 keeps Test Run aligned with unsaved graph edits; Task 8 covers Test Run integration and execution highlight; Task 9 covers verification.
- Red-flag scan: This plan contains no unresolved markers and no open-ended deferred implementation steps.
- Type consistency: The plan consistently uses `pipelinesToGraph`, `graphToPipelines`, `validatePipelineGraph`, `matchExecutionSteps`, `graphs`, `currentDirection`, `selectedNodeIds`, `selectedEdgeId`, and `lastRunMatches`.
