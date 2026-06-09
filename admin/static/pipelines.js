import { graphToPipelines, matchExecutionSteps, pipelinesToGraph, validatePipelineGraph } from './pipeline_graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_WIDTH = 180;
const NODE_BASE_HEIGHT = 72;
const NODE_PORT_GAP = 18;
const DEFAULT_PLUGINS = [
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

let currentDirection = 'client';
const pipelines = { client: [], server: [] };
let graphs = pipelinesToGraph(pipelines);
let availablePlugins = [];
let selectedNodeIds = new Set();
let executionNodeIds = new Set();
let zoom = 1;
let pan = { x: 56, y: 80 };
let dragState = null;
let wireState = null;
let marqueeState = null;
let controlsAbortController = null;

const PRESETS = {
  'event-1': () =>
    JSON.stringify(
      ['EVENT', {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pubkey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: 'Hello Nostr!',
        sig:
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      }],
      null,
      2,
    ),
  'event-4': () =>
    JSON.stringify(
      ['EVENT', {
        id: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        pubkey: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [[
          'p',
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        ]],
        content: 'encrypted DM content',
        sig:
          'gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg',
      }],
      null,
      2,
    ),
  'event-1059': () =>
    JSON.stringify(
      ['EVENT', {
        id: 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
        pubkey: 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1059,
        tags: [[
          'p',
          'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj',
        ]],
        content: 'gift wrap',
        sig:
          'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
      }],
      null,
      2,
    ),
  'req-basic': () => JSON.stringify(['REQ', 'sub1', { kinds: [1], limit: 10 }], null, 2),
  'req-search': () =>
    JSON.stringify(
      ['REQ', 'sub2', { kinds: [1], search: 'hello', limit: 10 }],
      null,
      2,
    ),
  close: () => JSON.stringify(['CLOSE', 'sub1'], null, 2),
};

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function toYamlValue(val, indent) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (/[:{}\[\],#&*!|>'"%@`]|^\s|\s$|^(true|false|null|~)$/i.test(val)) {
      return JSON.stringify(val);
    }
    return val;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const lines = val.map((v) => indent + '- ' + toYamlValue(v, indent + '  '));
    return '\n' + lines.join('\n');
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const lines = keys.map((k) => {
      const v = toYamlValue(val[k], indent + '  ');
      if (
        typeof val[k] === 'object' && val[k] !== null && !Array.isArray(val[k])
      ) {
        return indent + k + ':\n' +
          Object.keys(val[k]).map((sk) => indent + '  ' + sk + ': ' + toYamlValue(val[k][sk], indent + '    '))
            .join('\n');
      }
      if (Array.isArray(val[k]) && val[k].length > 0) {
        return indent + k + ':' + v;
      }
      return indent + k + ': ' + v;
    });
    return '\n' + lines.join('\n');
  }
  return String(val);
}

function entriesToYaml(entries, indent) {
  if (!entries || entries.length === 0) return indent + '  []\n';
  let out = '';
  for (const entry of entries) {
    out += indent + '- policy: ' + entry.policy + '\n';
    if (entry.config && Object.keys(entry.config).length > 0) {
      out += indent + '  config:\n';
      for (const [k, v] of Object.entries(entry.config)) {
        const yv = toYamlValue(v, indent + '      ');
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
          out += indent + '    ' + k + ':' + yv + '\n';
        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          out += indent + '    ' + k + ':' + yv + '\n';
        } else {
          out += indent + '    ' + k + ': ' + yv + '\n';
        }
      }
    }
  }
  return out;
}

export function buildYamlPreview(pipes) {
  let yaml = 'pipelines:\n';
  yaml += '  client:\n' + entriesToYaml(pipes.client, '  ');
  yaml += '  server:\n' + entriesToYaml(pipes.server, '  ');
  return yaml;
}

function policyIcon(name) {
  const icons = {
    accept: '✓',
    'kind-filter': '⊞',
    'write-guard': '✎',
    'protected-event': '🔒',
    'rate-limit': '⏱',
    'spam-filter': '🚫',
    'content-filter': '⊟',
    'pubkey-acl': '👤',
    'ip-filter': '🌐',
    when: '?',
    match: '≡',
    route: '→',
    start: '▶',
  };
  return icons[name] ?? '⚙';
}

function condensedConfig(node) {
  const cfg = node?.config ?? {};
  if (Object.keys(cfg).length === 0) return '';
  const parts = [];
  if (cfg.mode && cfg.kinds) parts.push(cfg.mode + ':' + cfg.kinds.join(','));
  if (cfg.allow_kinds) parts.push('allow:' + cfg.allow_kinds.join(','));
  if (cfg.deny_kinds) parts.push('deny:' + cfg.deny_kinds.join(','));
  if (cfg.require_auth !== undefined) {
    parts.push('require_auth:' + cfg.require_auth);
  }
  if (cfg.max_content_length !== undefined) {
    parts.push('max_len:' + cfg.max_content_length);
  }
  if (cfg.condition) {
    parts.push('if:' + JSON.stringify(cfg.condition).slice(0, 40));
  }
  if (cfg.allow) parts.push('allow:[' + cfg.allow.length + ']');
  if (cfg.deny) parts.push('deny:[' + cfg.deny.length + ']');
  if (cfg.upstream) parts.push('upstream:' + cfg.upstream);
  if (parts.length === 0) parts.push(Object.keys(cfg).slice(0, 2).join(', '));
  return parts.join(' · ');
}

export function defaultConfigForPolicy(name) {
  switch (name) {
    case 'accept':
      return {};
    case 'kind-filter':
      return { mode: 'allow', kinds: [1, 3, 6, 7] };
    case 'write-guard':
      return { require_auth: true };
    case 'protected-event':
      return { require_auth: true };
    case 'rate-limit':
      return { scope: 'connection', window: 60, max_events: 60, max_requests: 120 };
    case 'spam-filter':
      return { max_content_length: 1000 };
    case 'content-filter':
      return { blocked_words: [], blocked_patterns: [] };
    case 'pubkey-acl':
      return { mode: 'blocklist', target: 'author', pubkeys: [] };
    case 'ip-filter':
      return { blocklist: { ips: [], cidrs: [] } };
    case 'when':
      return { condition: { authenticated: true }, then: [], else: [] };
    case 'match':
      return { cases: [{ condition: {}, pipeline: [] }], default: [] };
    case 'route':
      return { upstream: '', condition: { message_type: 'REQ' } };
    default:
      return {};
  }
}

function currentGraph() {
  return graphs[currentDirection];
}

function isStartNode(node) {
  return node?.type === 'start' || node?.policy === 'start';
}

export function shouldRenderInputPort(node) {
  return !isStartNode(node);
}

export function isMovablePipelineNode(node) {
  return Boolean(node);
}

function policyNodes(graph) {
  return (graph?.nodes ?? []).filter((node) => !isStartNode(node));
}

function findNode(graph, nodeId) {
  return (graph?.nodes ?? []).find((node) => node.id === nodeId);
}

function firstEdgeFromPort(graph, from, fromPort) {
  return (graph?.edges ?? []).find((edge) => edge.from === from && edge.fromPort === fromPort);
}

function incomingEdge(graph, nodeId) {
  return (graph?.edges ?? []).find((edge) => edge.to === nodeId);
}

function nextGraphSerial(graph, prefix) {
  let max = 0;
  for (const item of [...(graph.nodes ?? []), ...(graph.edges ?? [])]) {
    const id = String(item.id ?? '');
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

function syncPipelinesFromGraphs() {
  const serialized = graphToPipelines(graphs);
  pipelines.client = serialized.client;
  pipelines.server = serialized.server;
}

function outputPortsFor(node) {
  if (!node) return [];
  if (isStartNode(node)) return [{ id: 'next', label: 'next' }];
  if (node.policy === 'when') {
    return [
      { id: 'then', label: 'then' },
      { id: 'else', label: 'else' },
      { id: 'next', label: 'next' },
    ];
  }
  if (node.policy === 'match') {
    const cases = Array.isArray(node.config?.cases) ? node.config.cases : [];
    return cases.map((_, index) => ({
      id: `case:${index}`,
      label: `case ${index + 1}`,
    }))
      .concat([{ id: 'default', label: 'default' }, {
        id: 'next',
        label: 'next',
      }]);
  }
  return [{ id: 'next', label: 'next' }];
}

function nodeHeight(node) {
  return Math.max(
    NODE_BASE_HEIGHT,
    42 + outputPortsFor(node).length * NODE_PORT_GAP,
  );
}

function portPosition(node, portId, role) {
  const height = nodeHeight(node);
  if (role === 'input') {
    return { x: node.x, y: node.y + height / 2 };
  }

  const ports = outputPortsFor(node);
  const index = Math.max(0, ports.findIndex((port) => port.id === portId));
  return {
    x: node.x + NODE_WIDTH,
    y: node.y + 28 + index * NODE_PORT_GAP,
  };
}

function edgePath(fromNode, edge) {
  const from = portPosition(fromNode, edge.fromPort, 'output');
  const toNode = findNode(currentGraph(), edge.to);
  if (!toNode) return '';
  const to = portPosition(toNode, 'in', 'input');
  const tension = Math.max(80, Math.abs(to.x - from.x) * 0.45);
  return `M ${from.x} ${from.y} C ${from.x + tension} ${from.y}, ${to.x - tension} ${to.y}, ${to.x} ${to.y}`;
}

function clearChildren(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        node.dataset[dataKey] = String(dataValue);
      }
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function htmlEl(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'className') node.className = String(value);
    else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === 'text') node.textContent = String(value);
    else if (key === 'htmlFor') node.htmlFor = String(value);
    else if (key === 'events') {
      for (const [eventName, handler] of Object.entries(value)) {
        node.addEventListener(eventName, handler);
      }
    } else if (key === 'style') {
      if (typeof value === 'string') node.style.cssText = value;
      else Object.assign(node.style, value);
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    node.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('pipeline-status');
  if (!el) return;
  clearChildren(el);
  if (!msg) return;
  const span = htmlEl('span', {
    className: 'badge ' + (isError ? 'badge-danger' : 'badge-success'),
    text: msg,
  });
  el.appendChild(span);
  setTimeout(() => {
    if (el.contains(span)) el.removeChild(span);
  }, 5000);
}

function setPersistentSummary() {
  const summary = document.getElementById('workbench-status-summary');
  if (!summary) return;
  const graph = currentGraph();
  const result = validatePipelineGraph(graph);
  const count = policyNodes(graph).length;
  const label = currentDirection === 'client' ? 'Client' : 'Server';
  summary.textContent = result.valid ? `${label}: ${count} nodes` : `${label}: ${result.errors.length} issue(s)`;
  summary.classList.toggle('text-danger', !result.valid);
}

function setModeTabs() {
  document.querySelectorAll('.pipeline-mode-tab').forEach((tab) => {
    const active = tab.dataset.pipeline === currentDirection;
    tab.classList.toggle('btn-primary', active);
    tab.classList.toggle('btn-ghost', !active);
  });
  const title = document.getElementById('canvas-title');
  if (title) {
    title.textContent = (currentDirection === 'client' ? 'Client' : 'Server') +
      ' Pipeline';
  }
}

function serializeCurrentPipelines() {
  syncPipelinesFromGraphs();
  return cloneValue(pipelines);
}

function renderYaml() {
  const yamlEl = document.getElementById('yaml-preview');
  if (!yamlEl) return;
  yamlEl.textContent = buildYamlPreview(serializeCurrentPipelines());
}

function renderPalette() {
  const palette = document.getElementById('policy-palette');
  if (!palette) return;
  clearChildren(palette);
  const names = availablePlugins.length > 0 ? availablePlugins : DEFAULT_PLUGINS;
  for (const name of names) {
    const item = htmlEl('button', {
      type: 'button',
      className: 'policy-palette-item',
      draggable: true,
      dataset: { policy: name },
      events: {
        click: () => addPolicyNode(name),
        dragstart: (event) => {
          event.dataTransfer?.setData('application/x-pfortner-policy', name);
          event.dataTransfer?.setData('text/plain', name);
        },
      },
    }, [
      htmlEl('span', {
        className: 'policy-palette-icon',
        text: policyIcon(name),
      }),
      htmlEl('span', { className: 'policy-palette-name', text: name }),
      htmlEl('span', { className: 'policy-palette-add', text: '+' }),
    ]);
    palette.appendChild(item);
  }
}

function graphPointFromEvent(event) {
  const svg = document.getElementById('pipeline-svg');
  const rect = svg.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - pan.x) / zoom,
    y: (event.clientY - rect.top - pan.y) / zoom,
  };
}

function replaceEdge(graph, from, fromPort, to) {
  if (from === to) return false;
  const target = findNode(graph, to);
  if (!target || isStartNode(target)) return false;
  graph.edges = (graph.edges ?? []).filter((edge) =>
    !(edge.from === from && edge.fromPort === fromPort) && edge.to !== to
  );
  graph.edges.push({
    id: `${graph.direction}-edge-${nextGraphSerial(graph, `${graph.direction}-edge-`)}`,
    from,
    fromPort,
    to,
    toPort: 'in',
  });
  return true;
}

function removeEdge(edgeId) {
  const graph = currentGraph();
  graph.edges = (graph.edges ?? []).filter((edge) => edge.id !== edgeId);
  executionNodeIds.clear();
  render();
}

function insertAfterSource(graph, sourceId, sourcePort, node) {
  const previousEdge = firstEdgeFromPort(graph, sourceId, sourcePort);
  graph.nodes.push(node);
  graph.edges = (graph.edges ?? []).filter((edge) => !(edge.from === sourceId && edge.fromPort === sourcePort));
  graph.edges.push({
    id: `${graph.direction}-edge-${nextGraphSerial(graph, `${graph.direction}-edge-`)}`,
    from: sourceId,
    fromPort: sourcePort,
    to: node.id,
    toPort: 'in',
  });
  if (previousEdge?.to) {
    graph.edges.push({
      id: `${graph.direction}-edge-${nextGraphSerial(graph, `${graph.direction}-edge-`)}`,
      from: node.id,
      fromPort: 'next',
      to: previousEdge.to,
      toPort: 'in',
    });
  }
}

function appendSourceFor(graph) {
  if (selectedNodeIds.size === 1) {
    const selected = findNode(graph, [...selectedNodeIds][0]);
    if (selected && !isStartNode(selected)) {
      return { id: selected.id, port: 'next' };
    }
  }

  const start = (graph.nodes ?? []).find(isStartNode);
  let source = start;
  let next = firstEdgeFromPort(graph, start?.id, 'next');
  const seen = new Set();
  while (next?.to && !seen.has(next.to)) {
    seen.add(next.to);
    source = findNode(graph, next.to);
    next = firstEdgeFromPort(graph, source?.id, 'next');
  }
  return { id: source?.id ?? `${graph.direction}-start`, port: 'next' };
}

function addPolicyNode(policyName, position = null) {
  const graph = currentGraph();
  const source = appendSourceFor(graph);
  const sourceNode = findNode(graph, source.id);
  const fallbackX = (sourceNode?.x ?? 0) + 240;
  const fallbackY = sourceNode?.y ?? 0;
  const node = {
    id: `${graph.direction}-node-${nextGraphSerial(graph, `${graph.direction}-node-`)}`,
    type: 'policy',
    policy: policyName,
    config: defaultConfigForPolicy(policyName),
    x: position?.x ?? fallbackX,
    y: position?.y ?? fallbackY,
    width: NODE_WIDTH,
    height: NODE_BASE_HEIGHT,
    path: [],
  };

  insertAfterSource(graph, source.id, source.port, node);
  selectedNodeIds = new Set([node.id]);
  executionNodeIds.clear();
  render();
  setStatus('Added ' + policyName);
}

function deleteSelectedNodes() {
  const graph = currentGraph();
  const deleting = new Set(
    [...selectedNodeIds].filter((id) => !isStartNode(findNode(graph, id))),
  );
  if (deleting.size === 0) return;

  for (const nodeId of deleting) {
    const incoming = incomingEdge(graph, nodeId);
    const outgoing = firstEdgeFromPort(graph, nodeId, 'next');
    if (incoming && outgoing && !deleting.has(outgoing.to)) {
      graph.edges.push({
        id: `${graph.direction}-edge-${nextGraphSerial(graph, `${graph.direction}-edge-`)}`,
        from: incoming.from,
        fromPort: incoming.fromPort,
        to: outgoing.to,
        toPort: 'in',
      });
    }
  }

  graph.nodes = graph.nodes.filter((node) => !deleting.has(node.id));
  graph.edges = graph.edges.filter((edge) => !deleting.has(edge.from) && !deleting.has(edge.to));
  selectedNodeIds.clear();
  executionNodeIds.clear();
  render();
  setStatus('Deleted ' + deleting.size + ' node(s)');
}

function addMatchCase(node) {
  if (node.policy !== 'match') return;
  const config = cloneValue(node.config ?? {});
  const cases = Array.isArray(config.cases) ? config.cases : [];
  cases.push({ condition: {}, pipeline: [] });
  config.cases = cases;
  node.config = config;
  render();
}

function removeMatchCase(node, index) {
  if (node.policy !== 'match') return;
  const config = cloneValue(node.config ?? {});
  const cases = Array.isArray(config.cases) ? config.cases : [];
  cases.splice(index, 1);
  config.cases = cases;
  node.config = config;
  const graph = currentGraph();
  graph.edges = graph.edges.filter((edge) => edge.from !== node.id || edge.fromPort !== `case:${index}`);
  for (const edge of graph.edges) {
    const match = /^case:(\d+)$/.exec(edge.fromPort ?? '');
    if (edge.from === node.id && match) {
      const oldIndex = Number(match[1]);
      if (oldIndex > index) edge.fromPort = `case:${oldIndex - 1}`;
    }
  }
  render();
}

function selectNode(nodeId, additive = false) {
  const graph = currentGraph();
  if (!findNode(graph, nodeId)) return;
  if (additive) {
    const next = new Set(selectedNodeIds);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    selectedNodeIds = next;
  } else {
    selectedNodeIds = new Set([nodeId]);
  }
  render();
}

function startNodeDrag(event, nodeId) {
  if (wireState) return;
  event.preventDefault();
  event.stopPropagation();
  if (!selectedNodeIds.has(nodeId)) {
    selectNode(nodeId, event.shiftKey || event.metaKey);
  }
  const start = graphPointFromEvent(event);
  const graph = currentGraph();
  dragState = {
    type: 'node',
    start,
    nodeStarts: [...selectedNodeIds].map((id) => {
      const node = findNode(graph, id);
      return { id, x: node.x, y: node.y };
    }),
  };
}

function startWire(event, nodeId, portId) {
  event.preventDefault();
  event.stopPropagation();
  wireState = {
    from: nodeId,
    fromPort: portId,
    point: graphPointFromEvent(event),
  };
  renderCanvas();
}

function startCanvasPointer(event) {
  const canvas = document.getElementById('pipeline-canvas');
  if (!canvas) return;
  if (event.button === 1 || event.altKey) {
    event.preventDefault();
    dragState = {
      type: 'pan',
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { ...pan },
    };
    return;
  }
  if (event.target?.id !== 'pipeline-svg') return;
  selectedNodeIds.clear();
  marqueeState = {
    start: { x: event.clientX, y: event.clientY },
    current: { x: event.clientX, y: event.clientY },
  };
  updateMarquee();
  renderInspector();
}

function updateMarquee() {
  const el = document.getElementById('selection-marquee');
  const canvas = document.getElementById('pipeline-canvas');
  if (!el || !canvas) return;
  if (!marqueeState) {
    el.style.display = 'none';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x1 = Math.min(marqueeState.start.x, marqueeState.current.x) - rect.left;
  const y1 = Math.min(marqueeState.start.y, marqueeState.current.y) - rect.top;
  const x2 = Math.max(marqueeState.start.x, marqueeState.current.x) - rect.left;
  const y2 = Math.max(marqueeState.start.y, marqueeState.current.y) - rect.top;
  el.style.display = 'block';
  el.style.left = x1 + 'px';
  el.style.top = y1 + 'px';
  el.style.width = Math.max(0, x2 - x1) + 'px';
  el.style.height = Math.max(0, y2 - y1) + 'px';
}

function finishMarquee() {
  if (!marqueeState) return;
  const graph = currentGraph();
  const svg = document.getElementById('pipeline-svg');
  const rect = svg.getBoundingClientRect();
  const left = Math.min(marqueeState.start.x, marqueeState.current.x);
  const right = Math.max(marqueeState.start.x, marqueeState.current.x);
  const top = Math.min(marqueeState.start.y, marqueeState.current.y);
  const bottom = Math.max(marqueeState.start.y, marqueeState.current.y);
  const selected = new Set();
  for (const node of graph.nodes ?? []) {
    const height = nodeHeight(node);
    const sx = rect.left + pan.x + node.x * zoom;
    const sy = rect.top + pan.y + node.y * zoom;
    const ex = sx + NODE_WIDTH * zoom;
    const ey = sy + height * zoom;
    if (ex >= left && sx <= right && ey >= top && sy <= bottom) {
      selected.add(node.id);
    }
  }
  selectedNodeIds = selected;
  marqueeState = null;
  updateMarquee();
  render();
}

function handlePointerMove(event) {
  if (dragState?.type === 'node') {
    const current = graphPointFromEvent(event);
    const dx = current.x - dragState.start.x;
    const dy = current.y - dragState.start.y;
    const graph = currentGraph();
    for (const start of dragState.nodeStarts) {
      const node = findNode(graph, start.id);
      if (!isMovablePipelineNode(node)) continue;
      node.x = Math.round((start.x + dx) / 8) * 8;
      node.y = Math.round((start.y + dy) / 8) * 8;
    }
    renderCanvas();
    renderMinimap();
    return;
  }

  if (dragState?.type === 'pan') {
    pan = {
      x: dragState.startPan.x + event.clientX - dragState.startClient.x,
      y: dragState.startPan.y + event.clientY - dragState.startClient.y,
    };
    renderCanvas();
    return;
  }

  if (wireState) {
    wireState.point = graphPointFromEvent(event);
    renderCanvas();
    return;
  }

  if (marqueeState) {
    marqueeState.current = { x: event.clientX, y: event.clientY };
    updateMarquee();
  }
}

function handlePointerUp(event) {
  if (wireState) {
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest?.('[data-port-role="input"]');
    if (target?.dataset.nodeId) {
      const graph = currentGraph();
      if (
        replaceEdge(
          graph,
          wireState.from,
          wireState.fromPort,
          target.dataset.nodeId,
        )
      ) {
        executionNodeIds.clear();
        setStatus('Connected ' + wireState.fromPort);
      }
    }
    wireState = null;
    render();
    return;
  }

  if (marqueeState) {
    finishMarquee();
    return;
  }

  dragState = null;
}

function renderEdges(group, graph) {
  const edgeLayer = svgEl('g', { class: 'pipeline-edge-layer' });
  for (const edge of graph.edges ?? []) {
    const fromNode = findNode(graph, edge.from);
    const toNode = findNode(graph, edge.to);
    if (!fromNode || !toNode) continue;
    const path = edgePath(fromNode, edge);
    edgeLayer.appendChild(svgEl('path', {
      class: 'pipeline-edge-hit',
      d: path,
      dataset: { edgeId: edge.id },
    }));
    edgeLayer.appendChild(svgEl('path', {
      class: 'pipeline-edge',
      d: path,
      dataset: { edgeId: edge.id },
    }));
  }
  group.appendChild(edgeLayer);
}

function renderWirePreview(group) {
  if (!wireState) return;
  const graph = currentGraph();
  const fromNode = findNode(graph, wireState.from);
  if (!fromNode) return;
  const from = portPosition(fromNode, wireState.fromPort, 'output');
  const to = wireState.point;
  const tension = Math.max(80, Math.abs(to.x - from.x) * 0.45);
  group.appendChild(svgEl('path', {
    class: 'pipeline-edge pipeline-edge-preview',
    d: `M ${from.x} ${from.y} C ${from.x + tension} ${from.y}, ${to.x - tension} ${to.y}, ${to.x} ${to.y}`,
  }));
}

function renderNode(group, node) {
  const height = nodeHeight(node);
  node.width = NODE_WIDTH;
  node.height = height;
  const selected = selectedNodeIds.has(node.id);
  const executed = executionNodeIds.has(node.id);
  const nodeGroup = svgEl('g', {
    class: [
      'pipeline-node',
      isStartNode(node) ? 'pipeline-node-start' : '',
      selected ? 'selected' : '',
      executed ? 'executed' : '',
    ].filter(Boolean).join(' '),
    transform: `translate(${node.x}, ${node.y})`,
    dataset: { nodeId: node.id },
    tabindex: '0',
  });

  nodeGroup.appendChild(svgEl('rect', {
    class: 'pipeline-node-card',
    width: NODE_WIDTH,
    height,
    rx: 8,
  }));
  nodeGroup.appendChild(svgEl('text', {
    class: 'pipeline-node-icon',
    x: 18,
    y: 29,
  }, [document.createTextNode(policyIcon(node.policy))]));
  nodeGroup.appendChild(svgEl('text', {
    class: 'pipeline-node-title',
    x: 42,
    y: 25,
  }, [document.createTextNode(node.policy)]));
  const configText = condensedConfig(node);
  nodeGroup.appendChild(svgEl('text', {
    class: 'pipeline-node-subtitle',
    x: 42,
    y: 44,
  }, [document.createTextNode(configText || node.id)]));

  if (shouldRenderInputPort(node)) {
    const input = portPosition({ ...node, x: 0, y: 0 }, 'in', 'input');
    nodeGroup.appendChild(svgEl('circle', {
      class: 'pipeline-port pipeline-port-input',
      cx: input.x,
      cy: input.y,
      r: 6,
      dataset: { nodeId: node.id, portRole: 'input' },
    }));
  }

  for (const port of outputPortsFor(node)) {
    const pos = portPosition({ ...node, x: 0, y: 0 }, port.id, 'output');
    nodeGroup.appendChild(svgEl('circle', {
      class: 'pipeline-port pipeline-port-output',
      cx: pos.x,
      cy: pos.y,
      r: 6,
      dataset: { nodeId: node.id, portId: port.id, portRole: 'output' },
    }));
    nodeGroup.appendChild(svgEl('text', {
      class: 'pipeline-port-label',
      x: NODE_WIDTH - 14,
      y: pos.y + 4,
      'text-anchor': 'end',
    }, [document.createTextNode(port.label)]));
  }

  nodeGroup.addEventListener('pointerdown', (event) => {
    if (event.target?.dataset?.portRole === 'output') {
      startWire(event, node.id, event.target.dataset.portId);
    } else {
      startNodeDrag(event, node.id);
    }
  });
  nodeGroup.addEventListener('click', (event) => {
    event.stopPropagation();
    selectNode(node.id, event.shiftKey || event.metaKey);
  });

  group.appendChild(nodeGroup);
}

function renderCanvas() {
  const svg = document.getElementById('pipeline-svg');
  if (!svg) return;
  clearChildren(svg);

  const graph = currentGraph();
  const viewport = svgEl('g', {
    class: 'pipeline-viewport',
    transform: `translate(${pan.x}, ${pan.y}) scale(${zoom})`,
  });
  renderEdges(viewport, graph);
  renderWirePreview(viewport);
  const nodeLayer = svgEl('g', { class: 'pipeline-node-layer' });
  for (const node of graph.nodes ?? []) renderNode(nodeLayer, node);
  viewport.appendChild(nodeLayer);
  svg.appendChild(viewport);

  svg.querySelectorAll('.pipeline-edge-hit').forEach((path) => {
    path.addEventListener('click', (event) => {
      event.stopPropagation();
      removeEdge(event.currentTarget.dataset.edgeId);
    });
  });

  const zoomLabel = document.getElementById('canvas-zoom-label');
  if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + '%';
}

function graphBounds(graph) {
  const nodes = graph?.nodes ?? [];
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + NODE_WIDTH));
  const maxY = Math.max(...nodes.map((node) => node.y + nodeHeight(node)));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function fitCanvas() {
  const svg = document.getElementById('pipeline-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const bounds = graphBounds(currentGraph());
  const nextZoom = Math.min(
    1.4,
    Math.max(
      0.35,
      Math.min(
        (rect.width - 80) / bounds.width,
        (rect.height - 80) / bounds.height,
      ),
    ),
  );
  zoom = Number.isFinite(nextZoom) ? nextZoom : 1;
  pan = {
    x: 40 - bounds.x * zoom +
      Math.max(0, (rect.width - bounds.width * zoom) / 2 - 40),
    y: 40 - bounds.y * zoom +
      Math.max(0, (rect.height - bounds.height * zoom) / 2 - 40),
  };
  renderCanvas();
  renderMinimap();
}

function setZoom(nextZoom, pivotEvent = null) {
  const svg = document.getElementById('pipeline-svg');
  if (!svg) return;
  const oldZoom = zoom;
  zoom = Math.max(0.35, Math.min(1.8, nextZoom));
  if (pivotEvent) {
    const rect = svg.getBoundingClientRect();
    const x = pivotEvent.clientX - rect.left;
    const y = pivotEvent.clientY - rect.top;
    pan = {
      x: x - ((x - pan.x) / oldZoom) * zoom,
      y: y - ((y - pan.y) / oldZoom) * zoom,
    };
  }
  renderCanvas();
  renderMinimap();
}

function renderMinimap() {
  const minimap = document.getElementById('minimap-svg');
  if (!minimap) return;
  clearChildren(minimap);
  const graph = currentGraph();
  const bounds = graphBounds(graph);
  const width = 160;
  const height = 96;
  const scale = Math.min(
    (width - 16) / Math.max(1, bounds.width),
    (height - 16) / Math.max(1, bounds.height),
  );
  const offsetX = 8 - bounds.x * scale;
  const offsetY = 8 - bounds.y * scale;
  minimap.setAttribute('viewBox', `0 0 ${width} ${height}`);
  minimap.appendChild(svgEl('rect', {
    class: 'minimap-bg',
    x: 0,
    y: 0,
    width,
    height,
    rx: 8,
  }));
  for (const edge of graph.edges ?? []) {
    const from = findNode(graph, edge.from);
    const to = findNode(graph, edge.to);
    if (!from || !to) continue;
    minimap.appendChild(svgEl('line', {
      class: 'minimap-edge',
      x1: offsetX + (from.x + NODE_WIDTH) * scale,
      y1: offsetY + (from.y + nodeHeight(from) / 2) * scale,
      x2: offsetX + to.x * scale,
      y2: offsetY + (to.y + nodeHeight(to) / 2) * scale,
    }));
  }
  for (const node of graph.nodes ?? []) {
    minimap.appendChild(svgEl('rect', {
      class: selectedNodeIds.has(node.id) ? 'minimap-node selected' : 'minimap-node',
      x: offsetX + node.x * scale,
      y: offsetY + node.y * scale,
      width: NODE_WIDTH * scale,
      height: nodeHeight(node) * scale,
      rx: 3,
    }));
  }
}

function renderInspector() {
  const inspector = document.getElementById('node-inspector');
  if (!inspector) return;
  clearChildren(inspector);
  const graph = currentGraph();
  const selected = [...selectedNodeIds].map((id) => findNode(graph, id)).filter(
    Boolean,
  );

  if (selected.length === 0) {
    inspector.appendChild(
      htmlEl('div', {
        className: 'pipeline-empty',
        text: 'Select a node to edit its config.',
      }),
    );
    return;
  }

  if (selected.length > 1) {
    inspector.appendChild(
      htmlEl('div', {
        className: 'inspector-title',
        text: selected.length + ' nodes selected',
      }),
    );
    inspector.appendChild(htmlEl('button', {
      type: 'button',
      className: 'btn btn-danger inspector-action',
      text: 'Delete Selected',
      events: { click: deleteSelectedNodes },
    }));
    return;
  }

  const node = selected[0];
  inspector.appendChild(
    htmlEl('div', { className: 'inspector-title', text: node.policy }),
  );
  inspector.appendChild(
    htmlEl('div', { className: 'inspector-muted', text: node.id }),
  );

  if (isStartNode(node)) {
    inspector.appendChild(
      htmlEl('div', {
        className: 'pipeline-empty compact',
        text: 'Start node',
      }),
    );
    return;
  }

  const label = htmlEl('label', {
    className: 'section-title',
    htmlFor: 'node-config-editor',
    text: 'Config JSON',
  });
  const textarea = htmlEl('textarea', {
    id: 'node-config-editor',
    className: 'config-editor-textarea',
    spellcheck: false,
  });
  textarea.value = JSON.stringify(node.config ?? {}, null, 2);

  const apply = htmlEl('button', {
    type: 'button',
    className: 'btn btn-primary inspector-action',
    text: 'Apply',
    events: {
      click: () => {
        try {
          node.config = textarea.value.trim() ? JSON.parse(textarea.value) : {};
          executionNodeIds.clear();
          render();
          setStatus('Updated ' + node.policy);
        } catch (e) {
          setStatus('Config parse error: ' + e.message, true);
        }
      },
    },
  });
  inspector.appendChild(label);
  inspector.appendChild(textarea);
  inspector.appendChild(apply);

  if (node.policy === 'match') {
    const cases = Array.isArray(node.config?.cases) ? node.config.cases : [];
    const branchBox = htmlEl('div', { className: 'inspector-branches' });
    branchBox.appendChild(
      htmlEl('div', { className: 'section-title', text: 'Cases' }),
    );
    cases.forEach((_, index) => {
      branchBox.appendChild(htmlEl('button', {
        type: 'button',
        className: 'pipeline-entry-btn',
        text: 'Remove case ' + (index + 1),
        events: { click: () => removeMatchCase(node, index) },
      }));
    });
    branchBox.appendChild(htmlEl('button', {
      type: 'button',
      className: 'btn btn-ghost inspector-action',
      text: '+ Case',
      events: { click: () => addMatchCase(node) },
    }));
    inspector.appendChild(branchBox);
  }

  inspector.appendChild(htmlEl('button', {
    type: 'button',
    className: 'btn btn-danger inspector-action',
    text: 'Delete Node',
    events: { click: deleteSelectedNodes },
  }));
}

function circleChar(action) {
  if (action === 'accept') return '✓';
  if (action === 'reject') return '✕';
  return '→';
}

function makeStepItem(step, match, isLast) {
  const item = htmlEl('div', {
    className: 'step-item',
    dataset: { nodeId: match?.nodeId ?? '' },
  });
  const lineDiv = htmlEl('div', { className: 'step-line' });
  lineDiv.appendChild(
    htmlEl('div', {
      className: 'step-circle ' + step.action,
      text: circleChar(step.action),
    }),
  );
  if (!isLast) {
    lineDiv.appendChild(htmlEl('div', { className: 'step-connector' }));
  }
  item.appendChild(lineDiv);

  const content = htmlEl('div', { className: 'step-content' });
  const nameRow = htmlEl('div');
  nameRow.appendChild(
    htmlEl('span', { className: 'step-policy-name', text: step.policy }),
  );
  nameRow.appendChild(
    htmlEl('span', {
      className: 'step-action-badge ' + step.action,
      text: String(step.action).toUpperCase(),
    }),
  );
  if (step.branch) {
    nameRow.appendChild(
      htmlEl('span', {
        className: 'step-action-badge next',
        text: step.branch,
      }),
    );
  }
  content.appendChild(nameRow);
  if (step.detail) {
    content.appendChild(
      htmlEl('div', { className: 'step-detail', text: step.detail }),
    );
  }
  if (step.response) {
    content.appendChild(
      htmlEl('div', {
        className: 'step-response',
        text: 'Response: ' + step.response,
      }),
    );
  }
  item.appendChild(content);
  return item;
}

function renderResults(data, matches = []) {
  const panel = document.getElementById('result-panel');
  if (!panel) return;
  clearChildren(panel);

  if (!data || !Array.isArray(data.steps)) {
    panel.appendChild(
      htmlEl('div', {
        className: 'playground-error',
        text: 'Invalid response from server',
      }),
    );
    return;
  }

  if (data.steps.length === 0) {
    panel.appendChild(htmlEl('div', {
      className: 'playground-empty',
      text: 'Pipeline is empty — message would pass through.',
    }));
  } else {
    const stepList = htmlEl('div', { className: 'step-list' });
    data.steps.forEach((step, index) =>
      stepList.appendChild(
        makeStepItem(step, matches[index], index === data.steps.length - 1),
      )
    );
    panel.appendChild(stepList);
  }

  const finalDiv = htmlEl('div', {
    className: 'final-result ' +
      (data.finalAction === 'accept' ? 'accept' : 'reject'),
    text: 'Final: ' + String(data.finalAction).toUpperCase(),
  });
  if (data.finalResponse) {
    finalDiv.appendChild(htmlEl('div', {
      style: 'font-size:13px;font-weight:400;margin-top:4px',
      text: data.finalResponse,
    }));
  }
  panel.appendChild(finalDiv);
}

function renderError(msg) {
  const panel = document.getElementById('result-panel');
  if (!panel) return;
  clearChildren(panel);
  panel.appendChild(
    htmlEl('div', { className: 'playground-error', text: msg }),
  );
}

function renderPresets() {
  const container = document.getElementById('preset-buttons');
  if (!container) return;
  clearChildren(container);
  for (const name of Object.keys(PRESETS)) {
    container.appendChild(htmlEl('button', {
      type: 'button',
      className: 'preset-btn',
      text: name,
      events: {
        click: () => {
          const textarea = document.getElementById('message-input');
          if (textarea) textarea.value = PRESETS[name]();
        },
      },
    }));
  }
}

function setDrawerOpen(open) {
  document.getElementById('test-run-drawer')?.classList.toggle(
    'collapsed',
    !open,
  );
}

async function runEvaluation() {
  setDrawerOpen(true);
  const btn = document.getElementById('btn-run');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running...';
  }

  const validation = validatePipelineGraph(currentGraph());
  if (!validation.valid) {
    renderError(
      'Graph validation failed: ' +
        validation.errors.map((error) => error.code).join(', '),
    );
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▷ Run';
    }
    return;
  }

  const textarea = document.getElementById('message-input');
  const rawMessage = textarea?.value?.trim();
  if (!rawMessage) {
    renderError('Please enter a message.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▷ Run';
    }
    return;
  }

  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch (e) {
    renderError('Invalid JSON: ' + e.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▷ Run';
    }
    return;
  }

  if (!Array.isArray(message)) {
    renderError('Message must be a JSON array, e.g. ["EVENT", {...}]');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▷ Run';
    }
    return;
  }

  const authenticated = document.getElementById('ctx-authenticated')?.checked ??
    false;
  const pubkey = document.getElementById('ctx-pubkey')?.value?.trim() ?? '';
  const clientIp = document.getElementById('ctx-ip')?.value?.trim() ||
    '127.0.0.1';
  const serialized = serializeCurrentPipelines();

  try {
    const res = await fetch('/admin/api/playground/evaluate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        direction: currentDirection,
        pipeline: serialized[currentDirection],
        connectionInfo: { authenticated, pubkey, clientIp },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      renderError('Server error: ' + (err.error || res.status));
      return;
    }

    const data = await res.json();
    const matches = matchExecutionSteps(currentGraph(), data.steps);
    executionNodeIds = new Set(
      matches.map((match) => match.nodeId).filter(Boolean),
    );
    renderCanvas();
    renderMinimap();
    renderResults(data, matches);
    const summary = document.getElementById('test-run-summary');
    if (summary) {
      summary.textContent = data.finalAction ? 'Final: ' + data.finalAction : 'Run complete';
    }
  } catch (e) {
    renderError('Request failed: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▷ Run';
    }
  }
}

async function fetchConfig() {
  const res = await fetch('/admin/api/config', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function fetchPlugins() {
  const res = await fetch('/admin/api/plugins', { credentials: 'same-origin' });
  if (!res.ok) return { plugins: [] };
  return res.json();
}

async function applyConfig() {
  const btn = document.getElementById('btn-apply-pipeline');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  try {
    const serialized = serializeCurrentPipelines();
    const clientValidation = validatePipelineGraph(graphs.client);
    const serverValidation = validatePipelineGraph(graphs.server);
    const errors = [
      ...clientValidation.errors.map((error) => 'client: ' + error.message),
      ...serverValidation.errors.map((error) => 'server: ' + error.message),
    ];
    if (errors.length > 0) {
      throw new Error('Fix pipeline wiring before saving: ' + errors[0]);
    }

    const res = await fetch('/admin/api/pipelines', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelines: serialized }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Save failed');
    }
    const data = await res.json().catch(() => ({}));
    pipelines.client = cloneValue(data.pipelines?.client ?? serialized.client);
    pipelines.server = cloneValue(data.pipelines?.server ?? serialized.server);
    renderYaml();
    setPersistentSummary();
    setStatus(
      'Pipeline saved and applied at ' + new Date().toLocaleTimeString(),
    );
  } catch (e) {
    setStatus('Error: ' + e.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✓ Save & Apply';
    }
  }
}

async function loadPipelinesPage() {
  try {
    const [configData, pluginsData] = await Promise.all([
      fetchConfig(),
      fetchPlugins(),
    ]);
    pipelines.client = cloneValue(configData.pipelines?.client ?? []);
    pipelines.server = cloneValue(configData.pipelines?.server ?? []);
    graphs = pipelinesToGraph(pipelines);
    selectedNodeIds.clear();
    executionNodeIds.clear();
    availablePlugins = Array.isArray(pluginsData.plugins) && pluginsData.plugins.length > 0
      ? pluginsData.plugins
      : DEFAULT_PLUGINS;
    render();
    fitCanvas();
  } catch (e) {
    setStatus('Error loading config: ' + e.message, true);
  }
}

function bindControls() {
  controlsAbortController?.abort();
  controlsAbortController = new AbortController();
  const signal = controlsAbortController.signal;

  document.querySelectorAll('.pipeline-mode-tab').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      const dir = event.currentTarget.dataset.pipeline;
      if (!dir || dir === currentDirection) return;
      currentDirection = dir;
      selectedNodeIds.clear();
      executionNodeIds.clear();
      render();
      fitCanvas();
    }, { signal });
  });

  document.getElementById('btn-refresh-pipelines')?.addEventListener(
    'click',
    loadPipelinesPage,
    { signal },
  );
  document.getElementById('btn-apply-pipeline')?.addEventListener(
    'click',
    applyConfig,
    { signal },
  );
  document.getElementById('btn-fit-canvas')?.addEventListener(
    'click',
    fitCanvas,
    { signal },
  );
  document.getElementById('btn-zoom-in')?.addEventListener(
    'click',
    () => setZoom(zoom + 0.1),
    { signal },
  );
  document.getElementById('btn-zoom-out')?.addEventListener(
    'click',
    () => setZoom(zoom - 0.1),
    { signal },
  );
  document.getElementById('btn-run-toolbar')?.addEventListener(
    'click',
    runEvaluation,
    { signal },
  );
  document.getElementById('btn-run')?.addEventListener('click', runEvaluation, {
    signal,
  });
  document.getElementById('btn-toggle-test-run')?.addEventListener(
    'click',
    () => {
      const drawer = document.getElementById('test-run-drawer');
      drawer?.classList.toggle('collapsed');
    },
    { signal },
  );

  const canvas = document.getElementById('pipeline-canvas');
  const svg = document.getElementById('pipeline-svg');
  canvas?.addEventListener('dragover', (event) => event.preventDefault(), {
    signal,
  });
  canvas?.addEventListener('drop', (event) => {
    event.preventDefault();
    const policy = event.dataTransfer?.getData('application/x-pfortner-policy') ||
      event.dataTransfer?.getData('text/plain');
    if (!policy) return;
    addPolicyNode(policy, graphPointFromEvent(event));
  }, { signal });
  svg?.addEventListener('pointerdown', startCanvasPointer, { signal });
  svg?.addEventListener('wheel', (event) => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY > 0 ? 0.92 : 1.08), event);
  }, { signal });

  document.addEventListener('pointermove', handlePointerMove, { signal });
  document.addEventListener('pointerup', handlePointerUp, { signal });
  document.addEventListener('keydown', (event) => {
    if (!document.getElementById('pipeline-workbench')) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelectedNodes();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      runEvaluation();
    }
  }, { signal });
}

function render() {
  setModeTabs();
  renderPalette();
  renderCanvas();
  renderInspector();
  renderYaml();
  renderPresets();
  renderMinimap();
  setPersistentSummary();
}

export function initPipelinesPage() {
  currentDirection = 'client';
  pipelines.client = [];
  pipelines.server = [];
  graphs = pipelinesToGraph(pipelines);
  availablePlugins = [];
  selectedNodeIds = new Set();
  executionNodeIds = new Set();
  zoom = 1;
  pan = { x: 56, y: 80 };
  dragState = null;
  wireState = null;
  marqueeState = null;

  bindControls();
  render();
  loadPipelinesPage();
}

if (typeof document !== 'undefined' && !globalThis.__PFORTNER_SPA__) {
  document.addEventListener('DOMContentLoaded', initPipelinesPage);
}
