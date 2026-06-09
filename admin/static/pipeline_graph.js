const DIRECTIONS = ['client', 'server'];
const NODE_WIDTH = 180;
const NODE_HEIGHT = 72;
const X_GAP = 240;
const Y_GAP = 112;

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isStartNode(node) {
  return node?.type === 'start' || node?.policy === 'start';
}

function isPolicyNode(node) {
  return node && !isStartNode(node) && (node.type === 'policy' || node.policy);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

function startNode(direction) {
  return {
    id: `${direction}-start`,
    type: 'start',
    policy: 'start',
    config: {},
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    path: [],
  };
}

function graphForPipeline(direction, pipeline) {
  const nodes = [startNode(direction)];
  const edges = [];
  let nodeIndex = 1;
  let edgeIndex = 1;
  let rowIndex = 0;

  function addPolicyNode(entry, path, depth) {
    const node = {
      id: `${direction}-node-${nodeIndex++}`,
      type: 'policy',
      policy: entry?.policy ?? '',
      config: cloneValue(entry?.config),
      x: depth * X_GAP,
      y: rowIndex++ * Y_GAP,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      path,
    };
    nodes.push(node);
    return node;
  }

  function addEdge(from, fromPort, to) {
    edges.push({
      id: `${direction}-edge-${edgeIndex++}`,
      from,
      fromPort,
      to,
      toPort: 'in',
    });
  }

  function appendPipeline(entries, from, fromPort, pathPrefix, depth) {
    if (!Array.isArray(entries) || entries.length === 0) return;

    let currentFrom = from;
    let currentPort = fromPort;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index] ?? {};
      const path = pathPrefix.concat(index);
      const node = addPolicyNode(entry, path, depth);
      addEdge(currentFrom, currentPort, node.id);
      appendBranchPipelines(entry, node, path, depth + 1);
      currentFrom = node.id;
      currentPort = 'next';
    }
  }

  function appendBranchPipelines(entry, node, path, depth) {
    const config = entry?.config ?? {};

    if (entry?.policy === 'when') {
      appendPipeline(config.then, node.id, 'then', path.concat('then'), depth);
      appendPipeline(config.else, node.id, 'else', path.concat('else'), depth);
      return;
    }

    if (entry?.policy === 'match') {
      const cases = Array.isArray(config.cases) ? config.cases : [];
      for (let index = 0; index < cases.length; index++) {
        appendPipeline(
          cases[index]?.pipeline,
          node.id,
          `case:${index}`,
          path.concat('case', index),
          depth,
        );
      }
      appendPipeline(
        config.default,
        node.id,
        'default',
        path.concat('default'),
        depth,
      );
    }
  }

  appendPipeline(pipeline, `${direction}-start`, 'next', [], 1);

  return {
    direction,
    nodes,
    edges,
  };
}

function nodeMapFor(graph) {
  return new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
}

function firstEdgeFromPort(graph, from, fromPort) {
  return (graph?.edges ?? []).find((edge) => edge.from === from && edge.fromPort === fromPort);
}

function outgoingCaseIndexes(graph, nodeId) {
  const indexes = [];
  for (const edge of graph?.edges ?? []) {
    if (edge.from !== nodeId) continue;
    const match = /^case:(\d+)$/.exec(edge.fromPort ?? '');
    if (match) indexes.push(Number(match[1]));
  }
  return indexes;
}

function branchPortsForNode(graph, node) {
  if (node.policy === 'when') return ['then', 'else'];
  if (node.policy !== 'match') return [];

  const config = node.config ?? {};
  const indexes = new Set(outgoingCaseIndexes(graph, node.id));
  if (Array.isArray(config.cases)) {
    for (let index = 0; index < config.cases.length; index++) {
      indexes.add(index);
    }
  }

  return [...indexes].sort((a, b) => a - b).map((index) => `case:${index}`)
    .concat('default');
}

function serializeGraphPipeline(graph) {
  const nodes = graph?.nodes ?? [];
  const nodeById = nodeMapFor(graph);
  const start = nodes.find(isStartNode);

  if (!start) return [];

  function serializeFromPort(from, fromPort, active) {
    const edge = firstEdgeFromPort(graph, from, fromPort);
    if (!edge) return [];
    return serializeLine(edge.to, new Set(active));
  }

  function serializeLine(firstNodeId, active) {
    const entries = [];
    let nodeId = firstNodeId;

    while (nodeId && !active.has(nodeId)) {
      const node = nodeById.get(nodeId);
      if (!isPolicyNode(node)) break;

      active.add(nodeId);
      entries.push(serializeNode(node, active));

      const nextEdge = firstEdgeFromPort(graph, node.id, 'next');
      nodeId = nextEdge?.to;
    }

    return entries;
  }

  function serializeNode(node, active) {
    const entry = {
      policy: node.policy,
    };
    const config = cloneValue(node.config);

    if (node.policy === 'when') {
      const branchConfig = config ?? {};
      branchConfig.then = serializeFromPort(node.id, 'then', active);
      if (hasOwn(branchConfig, 'else') || firstEdgeFromPort(graph, node.id, 'else')) {
        branchConfig.else = serializeFromPort(node.id, 'else', active);
      }
      entry.config = branchConfig;
    }

    if (node.policy === 'match') {
      const branchConfig = config ?? {};
      const caseIndexes = new Set(outgoingCaseIndexes(graph, node.id));
      if (Array.isArray(branchConfig.cases)) {
        for (let index = 0; index < branchConfig.cases.length; index++) {
          caseIndexes.add(index);
        }
      }
      const sortedIndexes = [...caseIndexes].sort((a, b) => a - b);
      branchConfig.cases = sortedIndexes.map((index) => {
        const matchCase = cloneValue(branchConfig.cases?.[index]) ?? {};
        matchCase.pipeline = serializeFromPort(
          node.id,
          `case:${index}`,
          active,
        );
        return matchCase;
      });
      if (hasOwn(branchConfig, 'default') || firstEdgeFromPort(graph, node.id, 'default')) {
        branchConfig.default = serializeFromPort(node.id, 'default', active);
      }
      entry.config = branchConfig;
    }

    if (node.policy !== 'when' && node.policy !== 'match' && config !== undefined) {
      entry.config = config;
    }

    return entry;
  }

  return serializeFromPort(start.id, 'next', new Set());
}

export function pipelinesToGraph(pipelines = {}) {
  return Object.fromEntries(
    DIRECTIONS.map((direction) => [
      direction,
      graphForPipeline(
        direction,
        Array.isArray(pipelines[direction]) ? pipelines[direction] : [],
      ),
    ]),
  );
}

export function validatePipelineGraph(graph) {
  const errors = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const startNodes = nodes.filter(isStartNode);

  if (startNodes.length !== 1) {
    errors.push({
      code: 'start-count',
      message: `Expected exactly one start node, found ${startNodes.length}.`,
    });
  }

  const incomingCounts = new Map();
  const adjacency = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    const fromExists = nodeIds.has(edge.from);
    const toExists = nodeIds.has(edge.to);

    if (!fromExists || !toExists) {
      errors.push({
        code: 'dangling-edge',
        edgeId: edge.id,
        from: edge.from,
        to: edge.to,
      });
      continue;
    }

    incomingCounts.set(edge.to, (incomingCounts.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from).push(edge.to);
  }

  for (const [nodeId, count] of incomingCounts.entries()) {
    if (count > 1) {
      errors.push({
        code: 'multiple-inputs',
        nodeId,
        count,
      });
    }
  }

  const visitState = new Map();
  let hasCycle = false;

  function visit(nodeId) {
    const state = visitState.get(nodeId) ?? 0;
    if (state === 1) {
      hasCycle = true;
      return;
    }
    if (state === 2) return;

    visitState.set(nodeId, 1);
    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      visit(nextNodeId);
    }
    visitState.set(nodeId, 2);
  }

  for (const nodeId of nodeIds) visit(nodeId);

  if (hasCycle) {
    errors.push({
      code: 'cycle',
      message: 'Graph contains a cycle.',
    });
  }

  if (startNodes.length === 1) {
    const reachable = new Set();
    const stack = [startNodes[0].id];

    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const nextNodeId of adjacency.get(nodeId) ?? []) {
        stack.push(nextNodeId);
      }
    }

    for (const node of nodes) {
      if (!isStartNode(node) && !reachable.has(node.id)) {
        errors.push({
          code: 'unreachable-node',
          nodeId: node.id,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function graphToPipelines(graphs = {}) {
  return {
    client: serializeGraphPipeline(graphs.client),
    server: serializeGraphPipeline(graphs.server),
  };
}

export function orderedPolicyNodes(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const nodeById = nodeMapFor(graph);
  const start = nodes.find(isStartNode);
  const ordered = [];
  const visited = new Set();

  function walkFromPort(from, fromPort) {
    const edge = firstEdgeFromPort(graph, from, fromPort);
    if (edge) walkLine(edge.to);
  }

  function walkLine(firstNodeId) {
    let nodeId = firstNodeId;
    const local = new Set();

    while (nodeId && !visited.has(nodeId) && !local.has(nodeId)) {
      const node = nodeById.get(nodeId);
      if (!isPolicyNode(node)) break;

      local.add(nodeId);
      visited.add(nodeId);
      ordered.push(node);

      for (const branchPort of branchPortsForNode(graph, node)) {
        walkFromPort(node.id, branchPort);
      }

      const nextEdge = firstEdgeFromPort(graph, node.id, 'next');
      nodeId = nextEdge?.to;
    }
  }

  if (start) {
    walkFromPort(start.id, 'next');
  }

  for (const node of nodes) {
    if (isPolicyNode(node) && !visited.has(node.id)) ordered.push(node);
  }

  return ordered;
}

export function matchExecutionSteps(graph, steps = []) {
  const nodeById = nodeMapFor(graph);
  const start = (graph?.nodes ?? []).find(isStartNode);
  const orderedNodes = orderedPolicyNodes(graph);
  let fallbackSearchFrom = 0;
  const frames = start ? [{ nodes: lineNodesFromPort(start.id, 'next'), index: 0 }] : [];

  function lineNodesFromPort(from, fromPort) {
    const edge = firstEdgeFromPort(graph, from, fromPort);
    if (!edge) return [];
    return lineNodesFrom(edge.to);
  }

  function lineNodesFrom(firstNodeId) {
    const nodes = [];
    const seen = new Set();
    let nodeId = firstNodeId;

    while (nodeId && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = nodeById.get(nodeId);
      if (!isPolicyNode(node)) break;
      nodes.push(node);
      nodeId = firstEdgeFromPort(graph, node.id, 'next')?.to;
    }

    return nodes;
  }

  function advanceFallbackAfter(node) {
    const index = orderedNodes.findIndex((orderedNode) => orderedNode.id === node.id);
    if (index >= fallbackSearchFrom) fallbackSearchFrom = index + 1;
  }

  function findInActiveFrames(policy) {
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      for (let index = frame.index; index < frame.nodes.length; index++) {
        if (frame.nodes[index].policy === policy) {
          frame.index = index + 1;
          return frame.nodes[index];
        }
      }
      frames.pop();
    }
    return null;
  }

  function findInFallbackOrder(policy) {
    for (let index = fallbackSearchFrom; index < orderedNodes.length; index++) {
      if (orderedNodes[index].policy === policy) {
        fallbackSearchFrom = index + 1;
        return orderedNodes[index];
      }
    }
    return null;
  }

  function caseBranchNodes(node) {
    return (graph?.edges ?? [])
      .filter((edge) => edge.from === node.id && /^case:\d+$/.test(edge.fromPort ?? ''))
      .sort((left, right) => Number(left.fromPort.slice(5)) - Number(right.fromPort.slice(5)))
      .flatMap((edge) => lineNodesFrom(edge.to));
  }

  function pushExecutedBranch(node, branch) {
    let branchNodes = [];
    if (node.policy === 'when' && (branch === 'then' || branch === 'else')) {
      branchNodes = lineNodesFromPort(node.id, branch);
    } else if (node.policy === 'match' && branch === 'default') {
      branchNodes = lineNodesFromPort(node.id, 'default');
    } else if (node.policy === 'match' && branch === 'case') {
      branchNodes = caseBranchNodes(node);
    }
    if (branchNodes.length > 0) frames.push({ nodes: branchNodes, index: 0 });
  }

  return (Array.isArray(steps) ? steps : []).map((step, stepIndex) => {
    const node = findInActiveFrames(step?.policy) ?? findInFallbackOrder(step?.policy);
    if (node) advanceFallbackAfter(node);
    if (node) pushExecutedBranch(node, step?.branch);

    return {
      stepIndex,
      nodeId: node?.id ?? null,
      action: step?.action,
    };
  });
}
