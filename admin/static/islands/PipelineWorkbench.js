import { graphToPipelines, pipelinesToGraph, validatePipelineGraph } from '../pipeline_graph.js';
import {
  buildPipelineDraft,
  fingerprintPipelines,
  LOCAL_DRAFT_KEY,
  normalizeWorkbenchDraft,
} from '../pipeline_workbench_state.js';

export default function PipelineWorkbench() {
  return null;
}

PipelineWorkbench.mount = function mountPipelineWorkbench(root) {
  const workbench = root.querySelector?.('#pipeline-workbench');
  if (!workbench || workbench.dataset.mounted === 'true') return;
  workbench.dataset.mounted = 'true';

  const clientButton = workbench.querySelector?.('#tab-client');
  const serverButton = workbench.querySelector?.('#tab-server');
  const canvasTitle = workbench.querySelector?.('#canvas-title');
  const paletteToggle = workbench.querySelector?.('#btn-toggle-palette');
  const publishButton = workbench.querySelector?.('#btn-publish-pipeline');
  const loadButton = workbench.querySelector?.('#btn-load-dag');
  const saveButton = workbench.querySelector?.('#btn-save-dag');
  const svg = workbench.querySelector?.('#pipeline-svg');
  let currentDirection = serverButton?.getAttribute?.('aria-pressed') === 'true' ? 'server' : 'client';

  const DEFAULT_VIEWPORTS = {
    client: { zoom: 1, pan: { x: 56, y: 80 } },
    server: { zoom: 1, pan: { x: 56, y: 80 } },
  };

  function setClass(element, className) {
    element?.setAttribute?.('class', className);
  }

  function createElement(tagName, options = {}) {
    const element = root.createElement?.(tagName) ?? document.createElement(tagName);
    if (options.className) element.setAttribute?.('class', options.className);
    if (options.id) element.setAttribute?.('id', options.id);
    if (options.text !== undefined) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attributes ?? {})) {
      element.setAttribute?.(name, value);
    }
    return element;
  }

  function createSvgElement(tagName, options = {}) {
    const element = root.createElementNS?.('http://www.w3.org/2000/svg', tagName) ??
      createElement(tagName);
    if (options.className) element.setAttribute?.('class', options.className);
    if (options.text !== undefined) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attributes ?? {})) {
      element.setAttribute?.(name, value);
    }
    return element;
  }

  function button(label, className, onClick, attributes = {}) {
    const element = createElement('button', {
      className,
      text: label,
      attributes: { type: 'button', ...attributes },
    });
    element.addEventListener?.('click', onClick);
    return element;
  }

  function closeModal() {
    workbench.querySelector?.('.modal-backdrop')?.remove?.();
  }

  function modalShell({ title, subtitle = '', modalClass = '', titleId }) {
    closeModal();

    const backdrop = createElement('div', { className: 'modal-backdrop' });
    const section = createElement('section', {
      className: ['workbench-modal', modalClass].filter(Boolean).join(' '),
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
    });
    const header = createElement('header', { className: 'workbench-modal-header' });
    const headingGroup = createElement('div');
    const heading = createElement('h2', {
      id: titleId,
      text: title,
    });
    headingGroup.appendChild?.(heading);
    if (subtitle) {
      headingGroup.appendChild?.(createElement('span', {
        className: 'text-muted',
        text: subtitle,
      }));
    }
    header.appendChild?.(headingGroup);
    header.appendChild?.(button('X', 'btn btn-ghost btn-icon', closeModal, {
      'aria-label': `Close ${title}`,
    }));

    const body = createElement('div', { className: 'workbench-modal-body' });
    const footer = createElement('footer', { className: 'workbench-modal-footer' });

    section.appendChild?.(header);
    section.appendChild?.(body);
    section.appendChild?.(footer);
    backdrop.appendChild?.(section);
    workbench.appendChild?.(backdrop);

    return { body, footer };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function errorMessage(error) {
    return error instanceof Error && error.message ? error.message : String(error);
  }

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        isPlainObject(body) && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`,
      );
    }
    return body;
  }

  async function postJson(url, body) {
    return await readJson(
      await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  function setStatusSummary(message, isError = false) {
    const summary = workbench.querySelector?.('#workbench-status-summary');
    if (summary) {
      summary.textContent = message;
      summary.setAttribute?.('data-status-kind', isError ? 'error' : 'success');
    }
  }

  function parseConfigJson(value) {
    try {
      const config = JSON.parse(value);
      if (!isPlainObject(config)) {
        return { error: 'Config JSON must be an object.' };
      }
      return { config };
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Unable to parse settings.';
      return { error: `Invalid JSON: ${message}` };
    }
  }

  function configForNode(node) {
    const raw = node?.getAttribute?.('data-node-config');
    if (!raw) return {};
    const parsed = parseConfigJson(raw);
    return parsed.config ?? {};
  }

  function nodePolicy(node) {
    return node?.getAttribute?.('data-node-policy') || node?.getAttribute?.('data-node-id') || 'node';
  }

  function isStartNode(node) {
    return node?.getAttribute?.('data-node-type') === 'start' || nodePolicy(node) === 'start';
  }

  function showError(container, message) {
    container.textContent = message;
    container.setAttribute?.('class', 'modal-error');
    container.setAttribute?.('role', 'alert');
  }

  function showPanelError(container, message) {
    container.textContent = message;
    container.setAttribute?.('class', 'playground-result-panel modal-error');
    container.setAttribute?.('role', 'alert');
  }

  function showPanelResult(container, value) {
    container.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    container.setAttribute?.('class', 'playground-result-panel');
    container.removeAttribute?.('role');
  }

  function readLocalDraft() {
    try {
      const raw = globalThis.localStorage?.getItem?.(LOCAL_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeLocalDraft(draft) {
    try {
      globalThis.localStorage?.setItem?.(LOCAL_DRAFT_KEY, JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
  }

  function parseTranslate(value) {
    const match = /translate\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(value ?? '');
    if (!match) return { x: 0, y: 0 };
    return { x: Number(match[1]), y: Number(match[2]) };
  }

  function renderedGraph(direction = currentDirection) {
    const nodes = [...(workbench.querySelectorAll?.('[data-node-id]') ?? [])]
      .map((node) => {
        const position = parseTranslate(node.getAttribute?.('transform'));
        return {
          id: node.getAttribute?.('data-node-id') ?? '',
          type: node.getAttribute?.('data-node-type') || 'policy',
          policy: nodePolicy(node),
          config: configForNode(node),
          x: position.x,
          y: position.y,
          width: 180,
          height: 72,
          path: [],
        };
      })
      .filter((node) => node.id.length > 0);
    const edges = [...(workbench.querySelectorAll?.('[data-edge-id]') ?? [])]
      .map((edge) => ({
        id: edge.getAttribute?.('data-edge-id') ?? '',
        from: edge.getAttribute?.('data-edge-from') ?? '',
        fromPort: edge.getAttribute?.('data-edge-from-port') || 'next',
        to: edge.getAttribute?.('data-edge-to') ?? '',
        toPort: edge.getAttribute?.('data-edge-to-port') || 'in',
      }))
      .filter((edge) => edge.id && edge.from && edge.to);
    return { direction, nodes, edges };
  }

  function graphStateFromDom() {
    return {
      ...pipelinesToGraph({ client: [], server: [] }),
      [currentDirection]: renderedGraph(currentDirection),
    };
  }

  let graphs = graphStateFromDom();
  let viewports = DEFAULT_VIEWPORTS;
  let publishedFingerprint = fingerprintPipelines(graphToPipelines(graphs));
  let initialLoadPromise = Promise.resolve();

  function cloneValue(value) {
    if (value === undefined) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeGraphs(value) {
    const empty = pipelinesToGraph({ client: [], server: [] });
    return {
      client: cloneValue(value?.client ?? empty.client),
      server: cloneValue(value?.server ?? empty.server),
    };
  }

  function syncRenderedDirection() {
    graphs = {
      ...graphs,
      [currentDirection]: renderedGraph(currentDirection),
    };
    return graphs;
  }

  function activeGraphs() {
    syncRenderedDirection();
    return graphs;
  }

  async function ensureInitialDataLoaded() {
    await initialLoadPromise;
  }

  function serializedRenderedPipelines() {
    return graphToPipelines(activeGraphs());
  }

  function graphValidationError() {
    syncRenderedDirection();
    for (const direction of ['client', 'server']) {
      const result = validatePipelineGraph(graphs[direction]);
      if (!result.valid) {
        const message = result.errors?.[0]?.message ?? result.errors?.[0]?.code ?? 'invalid graph';
        return `${direction} graph is invalid: ${message}`;
      }
    }
    return '';
  }

  function buildRenderedDraft() {
    const draftGraphs = activeGraphs();
    return buildPipelineDraft({
      graphs: draftGraphs,
      viewports,
      publishedFingerprint,
      now: Date.now(),
    });
  }

  function clearElement(element) {
    if (typeof element?.replaceChildren === 'function') {
      element.replaceChildren();
      return;
    }
    for (const child of [...(element?.childNodes ?? [])]) {
      element.removeChild?.(child);
    }
  }

  function nodeWidth(node) {
    return Number(node?.width) || 180;
  }

  function nodeHeight(node) {
    return Number(node?.height) || 72;
  }

  function edgePath(graph, edge) {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return '';

    const x1 = (Number(from.x) || 0) + nodeWidth(from);
    const y1 = (Number(from.y) || 0) + nodeHeight(from) / 2;
    const x2 = Number(to.x) || 0;
    const y2 = (Number(to.y) || 0) + nodeHeight(to) / 2;
    const tension = Math.max(80, Math.abs(x2 - x1) * 0.45);

    return `M ${x1} ${y1} C ${x1 + tension} ${y1}, ${x2 - tension} ${y2}, ${x2} ${y2}`;
  }

  function formatNodeConfig(config) {
    return config === undefined ? '' : JSON.stringify(config);
  }

  function renderGraph(direction = currentDirection) {
    if (!svg) return;
    const graph = graphs[direction] ?? { direction, nodes: [], edges: [] };
    clearElement(svg);

    const edgeLayer = createSvgElement('g', { className: 'pipeline-edge-layer' });
    for (const edge of graph.edges ?? []) {
      const path = edgePath(graph, edge);
      if (!path) continue;
      edgeLayer.appendChild?.(createSvgElement('path', {
        className: 'pipeline-edge',
        attributes: {
          'data-edge-id': edge.id,
          'data-edge-from': edge.from,
          'data-edge-from-port': edge.fromPort ?? '',
          'data-edge-to': edge.to,
          'data-edge-to-port': edge.toPort ?? '',
          d: path,
        },
      }));
    }

    const nodeLayer = createSvgElement('g', { className: 'pipeline-node-layer' });
    for (const node of graph.nodes ?? []) {
      const group = createSvgElement('g', {
        className: [
          'pipeline-node',
          node.type === 'start' || node.policy === 'start' ? 'pipeline-node-start' : '',
        ].filter(Boolean).join(' '),
        attributes: {
          transform: `translate(${Number(node.x) || 0}, ${Number(node.y) || 0})`,
          'data-node-id': node.id,
          'data-node-policy': node.policy ?? '',
          'data-node-type': node.type ?? '',
          'data-node-config': formatNodeConfig(node.config),
        },
      });
      group.appendChild?.(createSvgElement('rect', {
        className: 'pipeline-node-card',
        attributes: {
          width: String(nodeWidth(node)),
          height: String(nodeHeight(node)),
          rx: '8',
        },
      }));
      group.appendChild?.(createSvgElement('text', {
        className: 'pipeline-node-title',
        text: node.policy ?? node.id,
        attributes: { x: '16', y: '28' },
      }));
      group.appendChild?.(createSvgElement('text', {
        className: 'pipeline-node-subtitle',
        text: node.type === 'start' || node.policy === 'start' ? 'Pipeline start' : node.id,
        attributes: { x: '16', y: '50' },
      }));
      group.addEventListener?.('dblclick', () => {
        if (isStartNode(group)) {
          openPlaygroundModal(group);
          return;
        }
        openSettingsModal(group);
      });
      nodeLayer.appendChild?.(group);
    }

    svg.appendChild?.(edgeLayer);
    svg.appendChild?.(nodeLayer);
  }

  async function saveRenderedDraft() {
    await ensureInitialDataLoaded();
    const draft = buildRenderedDraft();
    const localSaved = writeLocalDraft(draft);

    try {
      await postJson('/admin/api/pipeline-draft', { draft });
      setStatusSummary('DAG saved');
    } catch (error) {
      if (localSaved) {
        setStatusSummary(
          `DAG saved locally; server draft failed: ${errorMessage(error)}`,
          true,
        );
        return;
      }
      setStatusSummary(`DAG save failed: ${errorMessage(error)}`, true);
    }
  }

  async function loadRenderedDraft() {
    let draft = null;
    let serverError = '';
    try {
      const data = await readJson(
        await fetch('/admin/api/pipeline-draft', { credentials: 'same-origin' }),
      );
      draft = isPlainObject(data) ? data.draft ?? null : null;
    } catch (error) {
      serverError = errorMessage(error);
      draft = readLocalDraft();
    }

    if (!draft) draft = readLocalDraft();
    if (!draft) {
      setStatusSummary('No saved DAG found', true);
      return;
    }

    const serverDraft = draft === null || draft === undefined ? null : normalizeWorkbenchDraft(draft);
    const localDraft = readLocalDraft();
    const localNormalized = localDraft === null || localDraft === undefined
      ? null
      : normalizeWorkbenchDraft(localDraft);
    const selectedDraft = serverDraft && !('error' in serverDraft)
      ? serverDraft.draft
      : localNormalized && !('error' in localNormalized)
      ? localNormalized.draft
      : null;

    if (!selectedDraft) {
      const message = serverDraft && 'error' in serverDraft
        ? serverDraft.error
        : localNormalized && 'error' in localNormalized
        ? localNormalized.error
        : 'No saved DAG found';
      setStatusSummary(`Draft load failed: ${message}`, true);
      return;
    }

    graphs = normalizeGraphs(selectedDraft.graphs);
    viewports = isPlainObject(selectedDraft.viewports) ? selectedDraft.viewports : DEFAULT_VIEWPORTS;
    renderGraph(currentDirection);
    const hasNodes = ['client', 'server'].some((direction) =>
      Array.isArray(graphs?.[direction]?.nodes) &&
      graphs[direction].nodes.length > 0
    );
    setStatusSummary(
      hasNodes ? 'Loaded saved DAG' : `No saved DAG found${serverError ? `; server draft failed: ${serverError}` : ''}`,
      !hasNodes,
    );
  }

  function pipelinesFromConfig(data) {
    return isPlainObject(data) && isPlainObject(data.pipelines) ? data.pipelines : null;
  }

  function normalizedDraft(value) {
    if (value === null || value === undefined) return null;
    const normalized = normalizeWorkbenchDraft(value);
    return 'error' in normalized ? null : normalized.draft;
  }

  async function loadInitialData() {
    let configPipelines = null;
    let draft = null;

    try {
      const config = await readJson(
        await fetch('/admin/api/config', { credentials: 'same-origin' }),
      );
      configPipelines = pipelinesFromConfig(config);
    } catch {
      configPipelines = null;
    }

    try {
      const data = await readJson(
        await fetch('/admin/api/pipeline-draft', { credentials: 'same-origin' }),
      );
      draft = normalizedDraft(isPlainObject(data) ? data.draft ?? null : null);
    } catch {
      draft = null;
    }

    if (!draft) draft = normalizedDraft(readLocalDraft());

    if (draft) {
      graphs = normalizeGraphs(draft.graphs);
      viewports = isPlainObject(draft.viewports) ? draft.viewports : DEFAULT_VIEWPORTS;
      renderGraph(currentDirection);
      setStatusSummary('Loaded saved DAG');
      return;
    }

    if (configPipelines) {
      graphs = normalizeGraphs(pipelinesToGraph(configPipelines));
      publishedFingerprint = fingerprintPipelines(configPipelines);
      renderGraph(currentDirection);
      setStatusSummary('Loaded active config');
    }
  }

  async function publishRenderedConfig() {
    try {
      await ensureInitialDataLoaded();
      const validationError = graphValidationError();
      if (validationError) {
        setStatusSummary(validationError, true);
        return;
      }
      const pipelines = serializedRenderedPipelines();
      await postJson('/admin/api/pipelines', { pipelines });
      publishedFingerprint = fingerprintPipelines(pipelines);
      closeModal();
      setStatusSummary('Pipeline published');
    } catch (error) {
      setStatusSummary(`Pipeline publish failed: ${errorMessage(error)}`, true);
    }
  }

  async function runPlayground(textarea, result) {
    await ensureInitialDataLoaded();
    let message;
    try {
      message = JSON.parse(textarea.value ?? '');
    } catch (error) {
      showPanelError(result, `Invalid JSON: ${errorMessage(error)}`);
      return;
    }

    if (!Array.isArray(message)) {
      showPanelError(result, 'Message must be a JSON array.');
      return;
    }

    try {
      const pipelines = serializedRenderedPipelines();
      const data = await postJson('/admin/api/playground/evaluate', {
        pipeline: pipelines[currentDirection] ?? [],
        message,
        direction: currentDirection,
        connectionInfo: {},
      });
      showPanelResult(result, data);
    } catch (error) {
      showPanelError(result, `Playground request failed: ${errorMessage(error)}`);
    }
  }

  function yamlValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function entriesToYaml(entries, indent) {
    if (!Array.isArray(entries) || entries.length === 0) return `${indent}  []\n`;
    let yaml = '';
    for (const entry of entries) {
      yaml += `${indent}- policy: ${entry.policy}\n`;
      const config = isPlainObject(entry.config) ? entry.config : {};
      const keys = Object.keys(config);
      if (keys.length > 0) {
        yaml += `${indent}  config:\n`;
        for (const key of keys) {
          yaml += `${indent}    ${key}: ${yamlValue(config[key])}\n`;
        }
      }
    }
    return yaml;
  }

  function buildYamlPreview() {
    const pipelines = serializedRenderedPipelines();
    let yaml = 'pipelines:\n';
    yaml += `  client:\n${entriesToYaml(pipelines.client, '  ')}`;
    yaml += `  server:\n${entriesToYaml(pipelines.server, '  ')}`;
    return yaml;
  }

  function openSettingsModal(node) {
    const { body, footer } = modalShell({
      title: nodePolicy(node),
      subtitle: node.getAttribute?.('data-node-id') ?? '',
      modalClass: 'node-settings-panel',
      titleId: 'node-settings-modal-title',
    });
    const tabs = createElement('div', {
      className: 'config-editor-tabs',
      attributes: { role: 'group', 'aria-label': 'Settings mode' },
    });
    tabs.appendChild?.(button('Interactive', 'btn btn-primary', () => undefined, {
      'aria-pressed': 'true',
    }));
    tabs.appendChild?.(button('JSON', 'btn btn-ghost', () => undefined, {
      'aria-pressed': 'false',
    }));
    const textarea = createElement('textarea', {
      className: 'config-editor-textarea modal-json-editor',
      attributes: { 'aria-label': 'Settings JSON' },
    });
    textarea.value = JSON.stringify(configForNode(node), null, 2);
    textarea.textContent = textarea.value;
    const error = createElement('div');

    body.appendChild?.(tabs);
    body.appendChild?.(textarea);
    body.appendChild?.(error);

    const actions = createElement('div', { className: 'modal-footer-actions' });
    actions.appendChild?.(button('Cancel', 'btn btn-ghost', closeModal));
    actions.appendChild?.(button('Apply', 'btn btn-primary', () => {
      const parsed = parseConfigJson(textarea.value ?? '');
      if (parsed.error) {
        showError(error, parsed.error);
        return;
      }
      node.setAttribute?.('data-node-config', JSON.stringify(parsed.config));
      const graph = graphs[currentDirection];
      const graphNode = graph?.nodes?.find((item) => item.id === node.getAttribute?.('data-node-id'));
      if (graphNode) graphNode.config = parsed.config;
      closeModal();
    }, { 'data-modal-action': 'apply-settings' }));
    footer.appendChild?.(createElement('span', {
      className: 'text-muted',
      text: 'Node settings',
    }));
    footer.appendChild?.(actions);
  }

  function openPlaygroundModal(node) {
    const { body, footer } = modalShell({
      title: 'Playground',
      subtitle: node?.getAttribute?.('data-node-id') ?? '',
      modalClass: 'fullscreen playground-panel',
      titleId: 'playground-modal-title',
    });
    body.setAttribute?.('class', 'workbench-modal-body playground-modal-body');
    const grid = createElement('div', { className: 'playground-modal-grid' });
    const inputSection = createElement('section', {
      attributes: { 'aria-label': 'Message input' },
    });
    const label = createElement('label', {
      className: 'form-label',
      text: 'Message',
      attributes: { for: 'playground-message-input' },
    });
    const textarea = createElement('textarea', {
      id: 'playground-message-input',
      className: 'message-textarea',
    });
    const resultSection = createElement('section', {
      attributes: { 'aria-label': 'Run result' },
    });
    const result = createElement('div', {
      className: 'playground-result-panel',
      text: 'No result yet.',
    });
    inputSection.appendChild?.(label);
    inputSection.appendChild?.(textarea);
    inputSection.appendChild?.(button('Run', 'btn btn-primary', () => {
      void runPlayground(textarea, result);
    }, { 'data-modal-action': 'run-playground' }));
    resultSection.appendChild?.(createElement('label', {
      className: 'form-label',
      text: 'Result',
    }));
    resultSection.appendChild?.(result);
    grid.appendChild?.(inputSection);
    grid.appendChild?.(resultSection);
    body.appendChild?.(grid);
    footer.appendChild?.(createElement('span', {
      className: 'text-muted',
      text: 'API evaluation',
    }));
    footer.appendChild?.(button('Close', 'btn btn-ghost', closeModal));
  }

  async function openPublishModal() {
    await ensureInitialDataLoaded();
    const validationError = graphValidationError();
    const { body, footer } = modalShell({
      title: 'Publish',
      subtitle: 'YAML preview',
      modalClass: 'publish-panel',
      titleId: 'publish-modal-title',
    });
    body.appendChild?.(createElement('pre', {
      className: 'yaml-preview',
      text: buildYamlPreview(),
    }));
    if (validationError) {
      body.appendChild?.(createElement('div', {
        className: 'modal-error',
        text: validationError,
        attributes: { role: 'alert' },
      }));
    }
    const actions = createElement('div', { className: 'modal-footer-actions' });
    actions.appendChild?.(button('Cancel', 'btn btn-ghost', closeModal));
    const publishAction = button('Publish', 'btn btn-primary', () => {
      void publishRenderedConfig();
    }, { 'data-modal-action': 'confirm-publish' });
    if (validationError) publishAction.setAttribute?.('disabled', '');
    actions.appendChild?.(publishAction);
    footer.appendChild?.(createElement('span', {
      className: 'text-muted',
      text: 'Writes active config',
    }));
    footer.appendChild?.(actions);
  }

  function setDirection(direction) {
    syncRenderedDirection();
    currentDirection = direction === 'server' ? 'server' : 'client';
    const isClient = direction === 'client';
    clientButton?.setAttribute?.('aria-pressed', String(isClient));
    serverButton?.setAttribute?.('aria-pressed', String(!isClient));
    setClass(
      clientButton,
      isClient ? 'btn btn-primary pipeline-mode-tab' : 'btn btn-ghost pipeline-mode-tab',
    );
    setClass(
      serverButton,
      isClient ? 'btn btn-ghost pipeline-mode-tab' : 'btn btn-primary pipeline-mode-tab',
    );
    if (canvasTitle) {
      canvasTitle.textContent = isClient ? 'Client Pipeline' : 'Server Pipeline';
    }
    renderGraph(currentDirection);
  }

  function toggleClass(element, className, enabled) {
    if (!element?.getAttribute || !element?.setAttribute) return;
    const classes = new Set(
      (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
    );
    if (enabled) {
      classes.add(className);
    } else {
      classes.delete(className);
    }
    element.setAttribute('class', [...classes].join(' '));
  }

  function setPaletteCollapsed(collapsed) {
    toggleClass(workbench, 'palette-collapsed', collapsed);
    if (paletteToggle) {
      paletteToggle.setAttribute?.(
        'aria-label',
        collapsed ? 'Expand palette' : 'Collapse palette',
      );
      paletteToggle.setAttribute?.(
        'title',
        collapsed ? 'Expand palette' : 'Collapse palette',
      );
      paletteToggle.textContent = collapsed ? '›' : '‹';
    }
  }

  clientButton?.addEventListener?.('click', () => {
    setDirection('client');
  });
  serverButton?.addEventListener?.('click', () => {
    setDirection('server');
  });
  loadButton?.addEventListener?.('click', () => {
    void loadRenderedDraft();
  });
  saveButton?.addEventListener?.('click', () => {
    void saveRenderedDraft();
  });
  publishButton?.addEventListener?.('click', () => {
    void openPublishModal();
  });
  paletteToggle?.addEventListener?.('click', () => {
    const collapsed = !(workbench.getAttribute?.('class') ?? '')
      .split(/\s+/)
      .includes('palette-collapsed');
    setPaletteCollapsed(collapsed);
  });
  workbench.querySelectorAll?.('[data-node-id]')?.forEach?.((node) => {
    node.addEventListener?.('dblclick', () => {
      if (isStartNode(node)) {
        openPlaygroundModal(node);
        return;
      }
      openSettingsModal(node);
    });
  });
  initialLoadPromise = loadInitialData();
};
