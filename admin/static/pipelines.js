import { graphToPipelines, matchExecutionSteps, pipelinesToGraph, validatePipelineGraph } from './pipeline_graph.js';
import {
  configToEditorRows,
  parseConfigJson,
  shouldOpenPlaygroundForNode,
  shouldRenderRunAction,
  shouldRenderSettingsAction,
  updateConfigFromEditorRows,
} from './pipeline_config_editor.js';
import {
  applyHistoryChange,
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
  recordHistorySnapshot,
} from './pipeline_workbench_state.js';

export {
  shouldOpenPlaygroundForNode,
  shouldRenderRunAction,
  shouldRenderSettingsAction,
} from './pipeline_config_editor.js';

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
let historyStates = initialDirectionHistoryState(graphs);
let historyState = historyStates[currentDirection];
let publishedFingerprint = fingerprintPipelines(pipelines);
let viewports = defaultViewports();
let lastSavedDraftFingerprint = '';
let availablePlugins = [];
let selectedNodeIdsByDirection = emptyDirectionSets();
let executionNodeIdsByDirection = emptyDirectionSets();
let selectedNodeIds = selectedNodeIdsByDirection[currentDirection];
let executionNodeIds = executionNodeIdsByDirection[currentDirection];
let zoom = 1;
let pan = { x: 56, y: 80 };
let dragState = null;
let wireState = null;
let marqueeState = null;
let controlsAbortController = null;
const playgroundState = {
  message: '',
  authenticated: false,
  pubkey: '',
  clientIp: '127.0.0.1',
};

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

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function defaultViewport() {
  return { zoom: 1, pan: { x: 56, y: 80 } };
}

function defaultViewports() {
  return {
    client: defaultViewport(),
    server: defaultViewport(),
  };
}

function emptyDirectionSets() {
  return {
    client: new Set(),
    server: new Set(),
  };
}

function setHistoryState(nextHistory) {
  historyState = nextHistory;
  historyStates[currentDirection] = nextHistory;
}

function setSelectedNodeIds(nextSelection) {
  selectedNodeIds = nextSelection;
  selectedNodeIdsByDirection[currentDirection] = nextSelection;
}

function setExecutionNodeIds(nextExecution) {
  executionNodeIds = nextExecution;
  executionNodeIdsByDirection[currentDirection] = nextExecution;
}

function activateDirectionState(direction) {
  historyState = historyStates[direction];
  selectedNodeIds = selectedNodeIdsByDirection[direction];
  executionNodeIds = executionNodeIdsByDirection[direction];
}

function resetDirectionalInteractionState() {
  selectedNodeIdsByDirection = emptyDirectionSets();
  executionNodeIdsByDirection = emptyDirectionSets();
  activateDirectionState(currentDirection);
}

function isPipelineDirection(value) {
  return value === 'client' || value === 'server';
}

function localStorageRef() {
  try {
    return globalThis.localStorage ?? null;
  } catch (_) {
    return null;
  }
}

function readStorageItem(key) {
  try {
    return localStorageRef()?.getItem(key) ?? null;
  } catch (_) {
    return null;
  }
}

function writeStorageItem(key, value) {
  try {
    localStorageRef()?.setItem(key, value);
  } catch (_) {
    // localStorage が使えない環境では永続化だけ諦める。
  }
}

function readStoredDirection() {
  const stored = readStorageItem(LAST_DIRECTION_KEY);
  return isPipelineDirection(stored) ? stored : 'client';
}

function persistDirection(direction) {
  if (isPipelineDirection(direction)) {
    writeStorageItem(LAST_DIRECTION_KEY, direction);
  }
}

function normalizeViewport(value) {
  const fallback = defaultViewport();
  const nextZoom = Number(value?.zoom);
  const nextX = Number(value?.pan?.x);
  const nextY = Number(value?.pan?.y);
  return {
    zoom: Number.isFinite(nextZoom) ? Math.max(0.35, Math.min(1.8, nextZoom)) : fallback.zoom,
    pan: {
      x: Number.isFinite(nextX) ? nextX : fallback.pan.x,
      y: Number.isFinite(nextY) ? nextY : fallback.pan.y,
    },
  };
}

function normalizeViewports(value) {
  return {
    client: normalizeViewport(value?.client),
    server: normalizeViewport(value?.server),
  };
}

function currentViewportsSnapshot() {
  return normalizeViewports({
    ...viewports,
    [currentDirection]: { zoom, pan: { x: pan.x, y: pan.y } },
  });
}

function currentDraftFingerprint() {
  return JSON.stringify({
    graphs,
    viewports: currentViewportsSnapshot(),
  });
}

function saveCurrentViewport() {
  viewports[currentDirection] = {
    zoom,
    pan: { x: pan.x, y: pan.y },
  };
}

function applyViewport(direction) {
  const viewport = normalizeViewport(viewports[direction]);
  viewports[direction] = viewport;
  zoom = viewport.zoom;
  pan = { x: viewport.pan.x, y: viewport.pan.y };
}

function readLocalDraft() {
  const raw = readStorageItem(LOCAL_DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeLocalDraft(draft) {
  writeStorageItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
}

function normalizeCompatibleDraft(rawDraft, currentPublishedFingerprint) {
  if (!rawDraft) return null;
  const normalized = normalizeWorkbenchDraft(rawDraft);
  if ('error' in normalized) return null;
  if (normalized.draft.lastPublishedFingerprint !== currentPublishedFingerprint) {
    return null;
  }
  return normalized.draft;
}

function draftTimestamp(draft) {
  const time = Date.parse(draft?.updatedAt ?? '');
  return Number.isFinite(time) ? time : 0;
}

function newestDraft(drafts) {
  return drafts.filter(Boolean).sort((a, b) => draftTimestamp(b) - draftTimestamp(a))[0] ?? null;
}

function recordGraphMutation() {
  return cloneValue(currentGraph());
}

function commitGraphMutation(beforeGraph) {
  if (!beforeGraph || sameValue(beforeGraph, currentGraph())) return;
  setHistoryState(recordHistorySnapshot({ ...historyState, present: beforeGraph }, currentGraph()));
  updateHistoryButtons();
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

export function buildPublishConfirmationMessage(yaml) {
  return 'Publish this pipeline configuration to the active config file?\n\n' + yaml;
}

function confirmPublish(serialized) {
  if (typeof globalThis.confirm !== 'function') return true;
  return globalThis.confirm(buildPublishConfirmationMessage(buildYamlPreview(serialized)));
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

function currentPipelinesFingerprint() {
  try {
    return fingerprintPipelines(graphToPipelines(graphs));
  } catch (_) {
    return '';
  }
}

function setPersistentSummary() {
  const summary = document.getElementById('workbench-status-summary');
  const graph = currentGraph();
  const result = validatePipelineGraph(graph);
  const count = policyNodes(graph).length;
  const label = currentDirection === 'client' ? 'Client' : 'Server';
  if (summary) {
    summary.textContent = result.valid ? `${label}: ${count} nodes` : `${label}: ${result.errors.length} issue(s)`;
    summary.classList.toggle('text-danger', !result.valid);
  }
  updateWorkbenchChangeBadges();
}

function setStateBadge(id, text, isWarning) {
  const badge = document.getElementById(id);
  if (!badge) return;
  badge.textContent = text;
  badge.classList.toggle('badge-warning', isWarning);
  badge.classList.toggle('badge-success', !isWarning);
}

function updateWorkbenchChangeBadges() {
  const state = getWorkbenchChangeState({
    currentDraftFingerprint: currentDraftFingerprint(),
    savedDraftFingerprint: lastSavedDraftFingerprint,
    currentPipelineFingerprint: currentPipelinesFingerprint(),
    publishedFingerprint,
  });
  setStateBadge('workbench-save-state', state.dagLabel, state.hasUnsavedDagChanges);
  setStateBadge('workbench-publish-state', state.publishLabel, state.hasUnpublishedChanges);
}

function updateHistoryButtons() {
  const undo = document.getElementById('btn-undo-pipeline');
  const redo = document.getElementById('btn-redo-pipeline');
  if (undo) undo.disabled = !isUndoAvailable(historyState);
  if (redo) redo.disabled = !isRedoAvailable(historyState);
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

export function replaceEdge(graph, from, fromPort, to) {
  if (from === to) return false;
  if ((graph.edges ?? []).some((edge) => edge.from === from && edge.fromPort === fromPort && edge.to === to)) {
    return false;
  }
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
  if (!(graph.edges ?? []).some((edge) => edge.id === edgeId)) return;
  const beforeGraphs = recordGraphMutation();
  graph.edges = (graph.edges ?? []).filter((edge) => edge.id !== edgeId);
  commitGraphMutation(beforeGraphs);
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

  const beforeGraphs = recordGraphMutation();
  insertAfterSource(graph, source.id, source.port, node);
  commitGraphMutation(beforeGraphs);
  setSelectedNodeIds(new Set([node.id]));
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

  const beforeGraphs = recordGraphMutation();
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
  commitGraphMutation(beforeGraphs);
  selectedNodeIds.clear();
  executionNodeIds.clear();
  render();
  setStatus('Deleted ' + deleting.size + ' node(s)');
}

function matchCaseCount(config) {
  return Array.isArray(config?.cases) ? config.cases.length : 0;
}

function initialMatchCaseIndexMap(config) {
  return Array.from({ length: matchCaseCount(config) }, (_, index) => index);
}

export function addMatchCaseDraftConfig(config, caseIndexMap) {
  const nextConfig = cloneValue(config ?? {});
  const cases = Array.isArray(nextConfig.cases) ? nextConfig.cases : [];
  cases.push({ condition: {}, pipeline: [] });
  nextConfig.cases = cases;
  const nextMap = Array.isArray(caseIndexMap)
    ? [...caseIndexMap, null]
    : cases.map((_, index) => index < cases.length - 1 ? index : null);

  return { config: nextConfig, caseIndexMap: nextMap };
}

export function removeMatchCaseDraftConfig(config, index, caseIndexMap) {
  const nextConfig = cloneValue(config ?? {});
  const previousCases = Array.isArray(config?.cases) ? config.cases : [];
  const cases = Array.isArray(nextConfig.cases) ? nextConfig.cases : [];
  const nextMap = Array.isArray(caseIndexMap) ? [...caseIndexMap] : previousCases.map((_, caseIndex) => caseIndex);

  if (index >= 0 && index < cases.length) {
    cases.splice(index, 1);
    nextMap.splice(index, 1);
  }
  nextConfig.cases = cases;

  return { config: nextConfig, caseIndexMap: nextMap.slice(0, cases.length) };
}

export function reconcileMatchCaseEdges(edges, nodeId, caseIndexMap, newCaseCount) {
  const count = Math.max(0, Number(newCaseCount) || 0);
  const indexMap = Array.isArray(caseIndexMap) ? caseIndexMap : null;

  return (edges ?? []).flatMap((edge) => {
    const match = /^case:(\d+)$/.exec(edge?.fromPort ?? '');
    if (edge?.from !== nodeId || !match) return [edge];

    const oldIndex = Number(match[1]);
    const newIndex = indexMap ? indexMap.findIndex((mappedIndex) => mappedIndex === oldIndex) : oldIndex;
    if (newIndex < 0 || newIndex >= count) return [];
    if (edge.fromPort === `case:${newIndex}`) return [edge];
    return [{ ...edge, fromPort: `case:${newIndex}` }];
  });
}

function selectNode(nodeId, additive = false) {
  const graph = currentGraph();
  if (!findNode(graph, nodeId)) return;
  if (additive) {
    const next = new Set(selectedNodeIds);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    setSelectedNodeIds(next);
  } else {
    setSelectedNodeIds(new Set([nodeId]));
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
    beforeGraphs: recordGraphMutation(),
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
  setSelectedNodeIds(selected);
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
      const beforeGraphs = recordGraphMutation();
      if (
        replaceEdge(
          graph,
          wireState.from,
          wireState.fromPort,
          target.dataset.nodeId,
        )
      ) {
        commitGraphMutation(beforeGraphs);
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

  if (dragState?.type === 'node') {
    const beforeGraphs = dragState.beforeGraphs;
    dragState = null;
    commitGraphMutation(beforeGraphs);
    render();
    return;
  }

  if (dragState?.type === 'pan') {
    saveCurrentViewport();
    updateWorkbenchChangeBadges();
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

  const action = shouldRenderRunAction(node)
    ? { type: 'run', label: '▶', title: 'Run playground' }
    : shouldRenderSettingsAction(node)
    ? { type: 'settings', label: '⚙', title: 'Node settings' }
    : null;
  if (action) {
    const actionGroup = svgEl('g', {
      class: 'pipeline-node-action',
      transform: `translate(${NODE_WIDTH - 27}, 19)`,
      dataset: { nodeId: node.id, nodeAction: action.type },
      tabindex: '0',
    });
    actionGroup.appendChild(svgEl('title', {}, [document.createTextNode(action.title)]));
    actionGroup.appendChild(svgEl('rect', {
      class: 'pipeline-node-action-bg',
      x: -12,
      y: -12,
      width: 24,
      height: 24,
      rx: 6,
    }));
    actionGroup.appendChild(svgEl('text', {
      class: 'pipeline-node-action-label',
      x: 0,
      y: 5,
      'text-anchor': 'middle',
    }, [document.createTextNode(action.label)]));
    actionGroup.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    actionGroup.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (action.type === 'run') openPlaygroundModal(node);
      else openNodeSettingsModal(node);
    });
    nodeGroup.appendChild(actionGroup);
  }

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
  nodeGroup.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (shouldOpenPlaygroundForNode(node)) openPlaygroundModal(node);
    else openNodeSettingsModal(node);
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
  saveCurrentViewport();
  updateWorkbenchChangeBadges();
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
  saveCurrentViewport();
  updateWorkbenchChangeBadges();
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
  // 旧固定 inspector は canvas-first shell で撤去済み。互換用に no-op として残す。
}

function isModalOpen(id) {
  const modal = document.getElementById(id);
  return Boolean(modal && !modal.classList.contains('hidden'));
}

function closeModalById(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  clearChildren(modal);
}

function closeNodeSettingsModal() {
  closeModalById('node-settings-modal');
}

function closePlaygroundModal() {
  updatePlaygroundStateFromDom();
  closeModalById('playground-modal');
}

function closeOpenModals() {
  closeNodeSettingsModal();
  closePlaygroundModal();
}

function defaultValueForRowType(type) {
  if (type === 'boolean') return false;
  if (type === 'number') return 0;
  if (type === 'array') return '[]';
  if (type === 'object') return '{}';
  if (type === 'null') return null;
  return '';
}

function configRowsFromNode(node) {
  return configToEditorRows(node.config ?? {});
}

function renderValueControl(row, onChange) {
  if (row.type === 'boolean') {
    return htmlEl('label', { className: 'config-boolean-control' }, [
      htmlEl('input', {
        type: 'checkbox',
        checked: Boolean(row.value),
        events: {
          change: (event) => onChange(event.currentTarget.checked),
        },
      }),
      htmlEl('span', { text: row.value ? 'true' : 'false' }),
    ]);
  }

  if (row.type === 'array' || row.type === 'object') {
    const textarea = htmlEl('textarea', {
      className: 'config-editor-textarea config-row-value',
      spellcheck: false,
      events: {
        input: (event) => onChange(event.currentTarget.value),
      },
    });
    textarea.value = String(row.value ?? defaultValueForRowType(row.type));
    return textarea;
  }

  const input = htmlEl('input', {
    className: 'form-input config-row-value',
    disabled: row.type === 'null',
    value: row.type === 'null' ? 'null' : String(row.value ?? ''),
    events: {
      input: (event) => {
        if (row.type === 'number') onChange(event.currentTarget.value);
        else onChange(event.currentTarget.value);
      },
    },
  });
  return input;
}

function renderConfigRows(rows, renderContent, onCaseRowEdited = null) {
  const wrapper = htmlEl('div', { className: 'config-editor-rows' });
  const typeOptions = ['string', 'number', 'boolean', 'array', 'object', 'null'];

  if (rows.length === 0) {
    wrapper.appendChild(htmlEl('div', {
      className: 'pipeline-empty compact',
      text: 'No config fields.',
    }));
  }

  rows.forEach((row, index) => {
    const keyInput = htmlEl('input', {
      className: 'form-input config-key-input',
      placeholder: 'key',
      value: row.key ?? '',
      events: {
        input: (event) => {
          const previousKey = rows[index].key;
          rows[index].key = event.currentTarget.value;
          if (previousKey === 'cases' || rows[index].key === 'cases') onCaseRowEdited?.();
        },
      },
    });
    const typeSelect = htmlEl(
      'select',
      {
        className: 'form-input config-type-select',
        events: {
          change: (event) => {
            rows[index].type = event.currentTarget.value;
            rows[index].value = defaultValueForRowType(rows[index].type);
            if (rows[index].key === 'cases') onCaseRowEdited?.();
            renderContent();
          },
        },
      },
      typeOptions.map((type) =>
        htmlEl('option', {
          value: type,
          selected: row.type === type,
          text: type,
        })
      ),
    );
    const valueControl = renderValueControl(row, (value) => {
      rows[index].value = value;
      if (rows[index].key === 'cases') onCaseRowEdited?.();
    });
    const remove = htmlEl('button', {
      type: 'button',
      className: 'btn btn-ghost config-row-remove',
      text: 'Remove',
      events: {
        click: () => {
          const removed = rows[index];
          rows.splice(index, 1);
          if (removed?.key === 'cases') onCaseRowEdited?.();
          renderContent();
        },
      },
    });
    wrapper.appendChild(
      htmlEl('div', { className: 'config-row' }, [
        keyInput,
        typeSelect,
        valueControl,
        remove,
      ]),
    );
  });

  wrapper.appendChild(htmlEl('button', {
    type: 'button',
    className: 'btn btn-ghost',
    text: '+ Field',
    events: {
      click: () => {
        rows.push({ key: '', type: 'string', value: '' });
        renderContent();
      },
    },
  }));
  return wrapper;
}

function renderMatchCaseControls(node, rows, changeDraftConfig) {
  if (node.policy !== 'match') return null;
  const parsed = updateConfigFromEditorRows(rows);
  if ('error' in parsed) return null;

  const cases = Array.isArray(parsed.config?.cases) ? parsed.config.cases : [];
  const controls = htmlEl('div', { className: 'config-branch-controls' }, [
    htmlEl('div', { className: 'section-title', text: 'Cases' }),
  ]);

  cases.forEach((_, index) => {
    controls.appendChild(htmlEl('button', {
      type: 'button',
      className: 'pipeline-entry-btn',
      text: 'Remove case ' + (index + 1),
      events: {
        click: () => {
          changeDraftConfig((config, caseIndexMap) => removeMatchCaseDraftConfig(config, index, caseIndexMap));
        },
      },
    }));
  });

  controls.appendChild(htmlEl('button', {
    type: 'button',
    className: 'btn btn-ghost',
    text: '+ Case',
    events: {
      click: () => {
        changeDraftConfig(addMatchCaseDraftConfig);
      },
    },
  }));
  return controls;
}

function openNodeSettingsModal(node) {
  if (!shouldRenderSettingsAction(node)) return;
  const root = document.getElementById('node-settings-modal');
  if (!root) return;

  closePlaygroundModal();
  setSelectedNodeIds(new Set([node.id]));
  render();

  let mode = 'interactive';
  let rows = configRowsFromNode(node);
  let jsonValue = JSON.stringify(node.config ?? {}, null, 2);
  let caseIndexMap = initialMatchCaseIndexMap(node.config);
  let errorMessage = '';

  const changeDraftConfig = (updateDraft) => {
    const parsed = updateConfigFromEditorRows(rows);
    if ('error' in parsed) {
      errorMessage = parsed.error;
      renderContent();
      return;
    }

    const nextDraft = updateDraft(parsed.config, caseIndexMap);
    rows = configToEditorRows(nextDraft.config);
    jsonValue = JSON.stringify(nextDraft.config, null, 2);
    caseIndexMap = nextDraft.caseIndexMap;
    errorMessage = '';
    renderContent(false);
  };

  const syncJsonFromRows = () => {
    const parsed = updateConfigFromEditorRows(rows);
    if ('error' in parsed) return parsed;
    jsonValue = JSON.stringify(parsed.config, null, 2);
    return parsed;
  };

  const syncRowsFromJson = () => {
    const parsed = parseConfigJson(jsonValue);
    if ('error' in parsed) return parsed;
    rows = configToEditorRows(parsed.config);
    caseIndexMap = initialMatchCaseIndexMap(parsed.config);
    return parsed;
  };

  const applyConfigUpdate = () => {
    const result = mode === 'json' ? parseConfigJson(jsonValue) : updateConfigFromEditorRows(rows);
    if ('error' in result) {
      errorMessage = result.error;
      renderContent();
      return;
    }

    const beforeGraphs = recordGraphMutation();
    node.config = cloneValue(result.config);
    if (node.policy === 'match') {
      const graph = currentGraph();
      graph.edges = reconcileMatchCaseEdges(
        graph.edges,
        node.id,
        caseIndexMap,
        matchCaseCount(node.config),
      );
    }
    commitGraphMutation(beforeGraphs);
    executionNodeIds.clear();
    closeNodeSettingsModal();
    render();
    setStatus('Updated ' + node.policy);
  };

  function renderContent(preserveFocus = true) {
    const activeElement = preserveFocus ? document.activeElement : null;
    clearChildren(root);
    root.classList.remove('hidden');

    const tabs = htmlEl('div', { className: 'config-editor-tabs' }, [
      htmlEl('button', {
        type: 'button',
        className: 'btn ' + (mode === 'interactive' ? 'btn-primary' : 'btn-ghost'),
        text: 'Interactive',
        events: {
          click: () => {
            if (mode === 'interactive') return;
            const synced = syncRowsFromJson();
            if ('error' in synced) {
              errorMessage = synced.error;
              renderContent();
              return;
            }
            mode = 'interactive';
            errorMessage = '';
            renderContent(false);
          },
        },
      }),
      htmlEl('button', {
        type: 'button',
        className: 'btn ' + (mode === 'json' ? 'btn-primary' : 'btn-ghost'),
        text: 'JSON',
        events: {
          click: () => {
            if (mode === 'json') return;
            const synced = syncJsonFromRows();
            if ('error' in synced) {
              errorMessage = synced.error;
              renderContent();
              return;
            }
            mode = 'json';
            errorMessage = '';
            renderContent(false);
          },
        },
      }),
    ]);

    const bodyChildren = [tabs];
    if (errorMessage) {
      bodyChildren.push(htmlEl('div', {
        className: 'modal-error',
        text: errorMessage,
      }));
    }

    if (mode === 'json') {
      const textarea = htmlEl('textarea', {
        id: 'node-config-json-editor',
        className: 'config-editor-textarea modal-json-editor',
        spellcheck: false,
        events: {
          input: (event) => {
            jsonValue = event.currentTarget.value;
            caseIndexMap = null;
          },
        },
      });
      textarea.value = jsonValue;
      bodyChildren.push(textarea);
    } else {
      bodyChildren.push(renderConfigRows(rows, renderContent, () => {
        caseIndexMap = null;
      }));
      const matchControls = renderMatchCaseControls(node, rows, changeDraftConfig);
      if (matchControls) bodyChildren.push(matchControls);
    }

    const modal = htmlEl('div', {
      className: 'workbench-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'node-settings-title',
      events: {
        click: (event) => event.stopPropagation(),
      },
    }, [
      htmlEl('div', { className: 'workbench-modal-header' }, [
        htmlEl('div', {}, [
          htmlEl('div', {
            id: 'node-settings-title',
            className: 'inspector-title',
            text: node.policy,
          }),
          htmlEl('div', { className: 'inspector-muted', text: node.id }),
        ]),
        htmlEl('button', {
          type: 'button',
          className: 'btn btn-ghost',
          text: 'Close',
          events: { click: closeNodeSettingsModal },
        }),
      ]),
      htmlEl('div', { className: 'workbench-modal-body' }, bodyChildren),
      htmlEl('div', { className: 'workbench-modal-footer' }, [
        htmlEl('button', {
          type: 'button',
          className: 'btn btn-danger',
          text: 'Delete Node',
          events: {
            click: () => {
              setSelectedNodeIds(new Set([node.id]));
              closeNodeSettingsModal();
              deleteSelectedNodes();
            },
          },
        }),
        htmlEl('div', { className: 'modal-footer-actions' }, [
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
            events: { click: applyConfigUpdate },
          }),
        ]),
      ]),
    ]);
    root.appendChild(modal);
    if (activeElement?.id) document.getElementById(activeElement.id)?.focus();
  }

  root.onclick = (event) => {
    if (event.target === root) closeNodeSettingsModal();
  };
  renderContent(false);
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

function updatePlaygroundStateFromDom() {
  const textarea = document.getElementById('message-input');
  const authenticated = document.getElementById('ctx-authenticated');
  const pubkey = document.getElementById('ctx-pubkey');
  const clientIp = document.getElementById('ctx-ip');
  if (textarea) playgroundState.message = textarea.value;
  if (authenticated) playgroundState.authenticated = authenticated.checked;
  if (pubkey) playgroundState.pubkey = pubkey.value;
  if (clientIp) playgroundState.clientIp = clientIp.value;
}

function openPlaygroundModal(node = null) {
  if (node && !shouldOpenPlaygroundForNode(node)) return;
  const root = document.getElementById('playground-modal');
  if (!root) return;
  if (isModalOpen('playground-modal')) return;

  closeNodeSettingsModal();
  clearChildren(root);
  root.classList.remove('hidden');
  root.onclick = (event) => {
    if (event.target === root) closePlaygroundModal();
  };

  const message = htmlEl('textarea', {
    id: 'message-input',
    className: 'message-textarea',
    spellcheck: false,
    placeholder: '["EVENT", {...}]',
    events: {
      input: (event) => {
        playgroundState.message = event.currentTarget.value;
      },
    },
  });
  message.value = playgroundState.message;

  const modal = htmlEl('div', {
    className: 'workbench-modal fullscreen',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'playground-title',
    events: {
      click: (event) => event.stopPropagation(),
    },
  }, [
    htmlEl('div', { className: 'workbench-modal-header' }, [
      htmlEl('div', {}, [
        htmlEl('div', {
          id: 'playground-title',
          className: 'inspector-title',
          text: 'Pipeline Playground',
        }),
        htmlEl('div', {
          className: 'inspector-muted',
          id: 'test-run-summary',
          text: currentDirection === 'client' ? 'Client pipeline' : 'Server pipeline',
        }),
      ]),
      htmlEl('button', {
        type: 'button',
        className: 'btn btn-ghost',
        text: 'Close',
        events: { click: closePlaygroundModal },
      }),
    ]),
    htmlEl('div', { className: 'workbench-modal-body playground-modal-body' }, [
      htmlEl('div', { className: 'playground-modal-grid' }, [
        htmlEl('div', { className: 'test-run-inputs' }, [
          htmlEl('div', { className: 'section-title', text: 'Presets' }),
          htmlEl('div', { className: 'preset-buttons', id: 'preset-buttons' }),
          htmlEl('label', {
            className: 'section-title',
            htmlFor: 'message-input',
            text: 'Message',
          }),
          message,
          htmlEl('div', { className: 'section-title', text: 'Context' }),
          htmlEl('div', { className: 'context-grid' }, [
            htmlEl('label', {
              className: 'context-label',
              htmlFor: 'ctx-authenticated',
              text: 'Authenticated',
            }),
            htmlEl('input', {
              id: 'ctx-authenticated',
              type: 'checkbox',
              checked: playgroundState.authenticated,
              events: {
                change: (event) => {
                  playgroundState.authenticated = event.currentTarget.checked;
                },
              },
            }),
            htmlEl('label', {
              className: 'context-label',
              htmlFor: 'ctx-pubkey',
              text: 'Pubkey',
            }),
            htmlEl('input', {
              id: 'ctx-pubkey',
              className: 'context-input',
              value: playgroundState.pubkey,
              events: {
                input: (event) => {
                  playgroundState.pubkey = event.currentTarget.value;
                },
              },
            }),
            htmlEl('label', {
              className: 'context-label',
              htmlFor: 'ctx-ip',
              text: 'Client IP',
            }),
            htmlEl('input', {
              id: 'ctx-ip',
              className: 'context-input',
              value: playgroundState.clientIp,
              events: {
                input: (event) => {
                  playgroundState.clientIp = event.currentTarget.value;
                },
              },
            }),
          ]),
          htmlEl('button', {
            id: 'btn-run',
            type: 'button',
            className: 'btn btn-primary',
            text: '▷ Run',
            events: { click: runEvaluation },
          }),
        ]),
        htmlEl('div', { className: 'test-run-results' }, [
          htmlEl('div', { className: 'section-title', text: 'Results' }),
          htmlEl('div', { id: 'result-panel', className: 'playground-result-panel' }, [
            htmlEl('div', {
              className: 'playground-empty',
              text: 'Run a message to inspect the evaluated path.',
            }),
          ]),
        ]),
      ]),
    ]),
  ]);
  root.appendChild(modal);
  renderPresets();
}

async function runEvaluation() {
  if (!isModalOpen('playground-modal')) openPlaygroundModal();
  updatePlaygroundStateFromDom();
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
    setExecutionNodeIds(
      new Set(
        matches.map((match) => match.nodeId).filter(Boolean),
      ),
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

async function fetchPipelineDraft() {
  try {
    const res = await fetch('/admin/api/pipeline-draft', { credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'HTTP ' + res.status);
    }
    const data = await res.json().catch(() => ({}));
    return data.draft ?? null;
  } catch (e) {
    setStatus('Draft load warning: ' + e.message, true);
    return null;
  }
}

async function postPipelineDraft(draft) {
  const res = await fetch('/admin/api/pipeline-draft', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'HTTP ' + res.status);
  }
  return res.json().catch(() => ({}));
}

async function saveDag(options = {}) {
  const btn = document.getElementById('btn-save-dag');
  const updateButton = options.updateButton !== false;
  if (btn && updateButton) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    saveCurrentViewport();
    const draft = buildPipelineDraft({
      graphs,
      viewports,
      publishedFingerprint,
      now: Date.now(),
    });
    writeLocalDraft(draft);
    lastSavedDraftFingerprint = currentDraftFingerprint();
    updateWorkbenchChangeBadges();

    try {
      await postPipelineDraft(draft);
    } catch (serverError) {
      if (!options.quietSuccess) {
        setStatus('DAG saved locally; server draft failed: ' + serverError.message, true);
      }
      return { ok: false, draft, serverError };
    }

    if (!options.quietSuccess) setStatus('DAG saved');
    return { ok: true, draft };
  } catch (e) {
    setStatus('DAG save failed: ' + e.message, true);
    return { ok: false, error: e };
  } finally {
    if (btn && updateButton) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }
}

async function publishConfig() {
  const btn = document.getElementById('btn-publish-pipeline');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Publishing...';
  }
  try {
    saveCurrentViewport();
    const clientValidation = validatePipelineGraph(graphs.client);
    const serverValidation = validatePipelineGraph(graphs.server);
    const errors = [
      ...clientValidation.errors.map((error) => 'client: ' + error.message),
      ...serverValidation.errors.map((error) => 'server: ' + error.message),
    ];
    if (errors.length > 0) {
      throw new Error('Fix pipeline wiring before publishing: ' + errors[0]);
    }

    const serialized = serializeCurrentPipelines();
    if (!confirmPublish(serialized)) {
      setStatus('Publish canceled');
      return;
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
    publishedFingerprint = fingerprintPipelines(serialized);
    const dagResult = await saveDag({ updateButton: false, quietSuccess: true });
    renderYaml();
    setPersistentSummary();
    if (dagResult.serverError) {
      setStatus('Pipeline published; DAG saved locally; server draft failed: ' + dagResult.serverError.message, true);
    } else if (dagResult.error) {
      setStatus('Pipeline published; DAG save failed: ' + dagResult.error.message, true);
    } else {
      setStatus('Pipeline published at ' + new Date().toLocaleTimeString());
    }
  } catch (e) {
    setStatus('Error: ' + e.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Publish';
    }
  }
}

async function loadPipelinesPage(options = {}) {
  const btn = options.updateButton === true ? document.getElementById('btn-load-dag') : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
  }
  try {
    const [configData, pluginsData, serverDraft] = await Promise.all([
      fetchConfig(),
      fetchPlugins(),
      fetchPipelineDraft(),
    ]);
    pipelines.client = cloneValue(configData.pipelines?.client ?? []);
    pipelines.server = cloneValue(configData.pipelines?.server ?? []);
    publishedFingerprint = fingerprintPipelines(pipelines);

    const localDraft = readLocalDraft();
    const selectedDraft = newestDraft([
      normalizeCompatibleDraft(serverDraft, publishedFingerprint),
      normalizeCompatibleDraft(localDraft, publishedFingerprint),
    ]);
    if (selectedDraft) {
      graphs = cloneValue(selectedDraft.graphs);
      viewports = normalizeViewports(selectedDraft.viewports);
    } else {
      graphs = pipelinesToGraph(pipelines);
      viewports = defaultViewports();
    }
    historyStates = initialDirectionHistoryState(graphs);
    activateDirectionState(currentDirection);
    applyViewport(currentDirection);
    lastSavedDraftFingerprint = currentDraftFingerprint();
    resetDirectionalInteractionState();
    availablePlugins = Array.isArray(pluginsData.plugins) && pluginsData.plugins.length > 0
      ? pluginsData.plugins
      : DEFAULT_PLUGINS;
    render();
    if (options.userInitiated) {
      setStatus(selectedDraft ? 'Loaded saved DAG' : 'Loaded active config');
    }
  } catch (e) {
    setStatus('Error loading config: ' + e.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Load';
    }
  }
}

function setPaletteCollapsed(collapsed, persist = true) {
  const workbench = document.getElementById('pipeline-workbench');
  workbench?.classList.toggle('palette-collapsed', collapsed);
  const toggle = document.getElementById('btn-toggle-palette');
  if (toggle) {
    toggle.textContent = collapsed ? '›' : '‹';
    toggle.title = collapsed ? 'Expand palette' : 'Collapse palette';
  }
  if (persist) writeStorageItem(PALETTE_COLLAPSED_KEY, collapsed ? 'true' : 'false');
}

function restorePaletteCollapsed() {
  setPaletteCollapsed(readStorageItem(PALETTE_COLLAPSED_KEY) === 'true', false);
}

function togglePaletteCollapsed() {
  const collapsed = document.getElementById('pipeline-workbench')?.classList.contains('palette-collapsed') ?? false;
  setPaletteCollapsed(!collapsed);
}

function switchDirection(direction) {
  if (!isPipelineDirection(direction) || direction === currentDirection) return;
  saveCurrentViewport();
  currentDirection = direction;
  persistDirection(direction);
  activateDirectionState(direction);
  applyViewport(direction);
  dragState = null;
  wireState = null;
  marqueeState = null;
  updateMarquee();
  render();
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target?.isContentEditable);
}

function applyGraphHistory(direction) {
  if (direction === 'undo' && !isUndoAvailable(historyState)) return;
  if (direction === 'redo' && !isRedoAvailable(historyState)) return;
  setHistoryState(applyHistoryChange(historyState, direction));
  graphs[currentDirection] = cloneValue(historyState.present);
  syncPipelinesFromGraphs();
  selectedNodeIds.clear();
  executionNodeIds.clear();
  dragState = null;
  wireState = null;
  marqueeState = null;
  updateMarquee();
  render();
}

function undoGraphChange() {
  applyGraphHistory('undo');
}

function redoGraphChange() {
  applyGraphHistory('redo');
}

function bindControls() {
  controlsAbortController?.abort();
  controlsAbortController = new AbortController();
  const signal = controlsAbortController.signal;

  document.querySelectorAll('.pipeline-mode-tab').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      switchDirection(event.currentTarget.dataset.pipeline);
    }, { signal });
  });

  document.getElementById('btn-load-dag')?.addEventListener(
    'click',
    () => loadPipelinesPage({ userInitiated: true, updateButton: true }),
    { signal },
  );
  document.getElementById('btn-save-dag')?.addEventListener(
    'click',
    () => saveDag(),
    { signal },
  );
  document.getElementById('btn-publish-pipeline')?.addEventListener(
    'click',
    publishConfig,
    { signal },
  );
  document.getElementById('btn-undo-pipeline')?.addEventListener(
    'click',
    undoGraphChange,
    { signal },
  );
  document.getElementById('btn-redo-pipeline')?.addEventListener(
    'click',
    redoGraphChange,
    { signal },
  );
  document.getElementById('btn-run-pipeline')?.addEventListener(
    'click',
    () => openPlaygroundModal(),
    { signal },
  );
  document.getElementById('btn-toggle-palette')?.addEventListener(
    'click',
    togglePaletteCollapsed,
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
    if (isModalOpen('node-settings-modal') || isModalOpen('playground-modal')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOpenModals();
      }
      return;
    }
    const target = event.target;
    if (isEditableTarget(target)) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoGraphChange();
      else undoGraphChange();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === 'y') {
      event.preventDefault();
      redoGraphChange();
      return;
    }
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
  updateHistoryButtons();
}

export function initPipelinesPage() {
  currentDirection = readStoredDirection();
  pipelines.client = [];
  pipelines.server = [];
  graphs = pipelinesToGraph(pipelines);
  historyStates = initialDirectionHistoryState(graphs);
  activateDirectionState(currentDirection);
  publishedFingerprint = fingerprintPipelines(pipelines);
  viewports = defaultViewports();
  applyViewport(currentDirection);
  lastSavedDraftFingerprint = currentDraftFingerprint();
  availablePlugins = [];
  resetDirectionalInteractionState();
  dragState = null;
  wireState = null;
  marqueeState = null;

  bindControls();
  restorePaletteCollapsed();
  render();
  loadPipelinesPage();
}

if (typeof document !== 'undefined' && !globalThis.__PFORTNER_SPA__) {
  document.addEventListener('DOMContentLoaded', initPipelinesPage);
}
