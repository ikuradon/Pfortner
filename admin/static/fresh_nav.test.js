import { assertEquals, assertMatch, assertStrictEquals } from '@std/assert';

class FakeDocument {
  listeners = [];
  title = '';
  childNodes = [];
  moduleElements = [];

  constructor({ title = '', childNodes = [], moduleElements = [] } = {}) {
    this.title = title;
    this.moduleElements = moduleElements;
    this.setChildNodes(childNodes);
  }

  addEventListener(type, listener) {
    this.listeners.push({ type, listener });
  }

  dispatchEvent(event) {
    for (const { type, listener } of this.listeners) {
      if (type === event.type) {
        listener({
          target: event.target ?? this,
          currentTarget: this,
          preventDefault() {},
          stopPropagation() {},
          ...event,
        });
      }
    }
  }

  setChildNodes(childNodes) {
    this.childNodes = childNodes;
    this.relink();
  }

  relink() {
    for (const [index, node] of this.childNodes.entries()) {
      node.parentNode = this;
      node.nextSibling = this.childNodes[index + 1] ?? null;
    }
  }

  createTreeWalker() {
    const comments = this.childNodes.filter((node) => node.nodeType === 8);
    let index = 0;
    return {
      nextNode() {
        return comments[index++] ?? null;
      },
    };
  }

  importNode(node) {
    return node.clone();
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(textContent) {
    return new FakeText(textContent);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }

  insertBefore(node, reference) {
    const index = this.childNodes.indexOf(reference);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    this.relink();
  }

  appendChild(node) {
    this.childNodes.push(node);
    this.relink();
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    this.relink();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    if (selector === 'script[type="module"], link[rel="modulepreload"]') {
      return this.moduleElements;
    }
    return this.childNodes.flatMap((node) => node.querySelectorAll?.(selector) ?? []);
  }
}

class FakeWindow {
  listeners = [];

  addEventListener(type, listener) {
    this.listeners.push({ type, listener });
  }

  dispatchEvent(event) {
    for (const { type, listener } of this.listeners) {
      if (type === event.type) listener(event);
    }
  }
}

class FakeComment {
  nodeType = 8;
  parentNode = null;
  nextSibling = null;

  constructor(data) {
    this.data = data;
  }

  clone() {
    return new FakeComment(this.data);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
}

class FakeText {
  nodeType = 3;
  parentNode = null;
  parentElement = null;
  nextSibling = null;

  constructor(textContent) {
    this._textContent = String(textContent);
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  querySelectorAll() {
    return [];
  }

  clone() {
    return new FakeText(this.textContent);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
}

class FakeElement {
  nodeType = 1;
  parentNode = null;
  parentElement = null;
  nextSibling = null;
  childNodes = [];
  listeners = [];
  dataset = {};
  _textContent = '';

  constructor(tagName, attributes = {}, textContent = '', childNodes = []) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.href = attributes.href;
    this.target = attributes.target ?? '';
    this.value = attributes.value ?? '';
    this.textContent = textContent;
    this.disabled = Object.hasOwn(attributes, 'disabled');
    this.style = {};
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = String(value);
        this.attributes.set(`data-${kebabCase(String(key))}`, String(value));
        return true;
      },
    });
    for (const [name, value] of Object.entries(attributes)) {
      if (name.startsWith('data-')) {
        this.dataset[camelCase(name.slice(5))] = value;
      }
    }
    this.setChildNodes(childNodes);
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  get textContent() {
    if (this._textContent || this.childNodes.length === 0) {
      return this._textContent;
    }
    return this.childNodes.map((node) => node.textContent ?? '').join('');
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get classList() {
    return {
      contains: (className) =>
        (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
          .includes(className),
      toggle: (className, force) => {
        const classes = new Set(
          (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
        );
        const enabled = force === undefined ? !classes.has(className) : Boolean(force);
        if (enabled) classes.add(className);
        else classes.delete(className);
        this.setAttribute('class', [...classes].join(' '));
        return enabled;
      },
      add: (className) => {
        const classes = new Set(
          (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
        );
        classes.add(className);
        this.setAttribute('class', [...classes].join(' '));
      },
      remove: (className) => {
        const classes = new Set(
          (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
        );
        classes.delete(className);
        this.setAttribute('class', [...classes].join(' '));
      },
    };
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'href') this.href = String(value);
    if (name === 'target') this.target = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'disabled') this.disabled = true;
    if (name.startsWith('data-')) {
      this.dataset[camelCase(name.slice(5))] = String(value);
    }
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'disabled') this.disabled = false;
  }

  setChildNodes(childNodes) {
    this.childNodes = childNodes;
    for (const [index, node] of this.childNodes.entries()) {
      node.parentNode = this;
      node.parentElement = this;
      node.nextSibling = this.childNodes[index + 1] ?? null;
    }
  }

  matchesSelector(selector) {
    if (selector.includes(',')) {
      return selector.split(',').some((part) => this.matchesSelector(part.trim()));
    }
    if (selector.startsWith('#')) {
      return this.getAttribute('id') === selector.slice(1);
    }
    if (selector.startsWith('.')) {
      return (this.getAttribute('class') ?? '').split(/\s+/).includes(selector.slice(1));
    }
    if (/^(?:\[[^\]]+\])+$/.test(selector) && (selector.match(/\[/g)?.length ?? 0) > 1) {
      const parts = selector.match(/\[[^\]]+\]/g) ?? [];
      return parts.every((part) => this.matchesSelector(part));
    }
    const attrMatch = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attrMatch) {
      const [, name, value] = attrMatch;
      return value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value;
    }
    if (selector === '[data-admin-island-smoke="true"]') {
      return this.getAttribute('data-admin-island-smoke') === 'true';
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = this.matchesSelector(selector) ? [this] : [];
    for (const child of this.childNodes) {
      matches.push(...(child.querySelectorAll?.(selector) ?? []));
    }
    return matches;
  }

  closest(selector) {
    if (
      selector === 'a[href]' && this.tagName === 'A' &&
      this.hasAttribute('href')
    ) {
      return this;
    }
    for (let node = this; node; node = node.parentElement) {
      if (node.matchesSelector?.(selector)) return node;
    }
    return null;
  }

  addEventListener(type, listener) {
    this.listeners.push({ type, listener });
  }

  appendChild(node) {
    this.childNodes.push(node);
    this.setChildNodes(this.childNodes);
    return node;
  }

  insertBefore(node, reference) {
    const index = this.childNodes.indexOf(reference);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    this.setChildNodes(this.childNodes);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    this.setChildNodes(this.childNodes);
    return node;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  dispatchEvent(event) {
    for (const { type, listener } of this.listeners) {
      if (type === event.type) {
        listener({
          target: this,
          currentTarget: this,
          preventDefault() {},
          stopPropagation() {},
          ...event,
        });
      }
    }
  }

  clone() {
    const clone = new FakeElement(
      this.tagName,
      Object.fromEntries(this.attributes),
      this._textContent,
      this.childNodes.map((node) => node.clone()),
    );
    clone.dataset = { ...this.dataset };
    return clone;
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
    };
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
}

function kebabCase(value) {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function setGlobal(name, value) {
  const hadValue = Object.prototype.hasOwnProperty.call(globalThis, name);
  const previousValue = globalThis[name];

  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
  });

  return () => {
    if (hadValue) {
      Object.defineProperty(globalThis, name, {
        value: previousValue,
        configurable: true,
      });
    } else {
      delete globalThis[name];
    }
  };
}

setGlobal('localStorage', {
  getItem() {
    return null;
  },
  setItem() {},
});

async function importFreshNav() {
  return await import(`../client/fresh_nav.js?test=${crypto.randomUUID()}`);
}

async function waitFor(predicate) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

function transformPan(transform) {
  const match = /^translate\(([-\d.]+), ([-\d.]+)\) scale\(([-\d.]+)\)$/.exec(
    transform ?? '',
  );
  if (!match) throw new Error(`Unexpected transform: ${transform}`);
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    zoom: Number(match[3]),
  };
}

function paletteItem(policy) {
  return new FakeElement('button', {
    class: 'policy-palette-item',
    'data-policy': policy,
    disabled: '',
  }, policy);
}

function pipelineWorkbenchFixture({ standalonePolicy = null, extraNodes = [] } = {}) {
  const clientButton = new FakeElement('button', {
    id: 'tab-client',
    'aria-pressed': 'true',
    class: 'btn btn-primary pipeline-mode-tab',
    'data-pipeline': 'client',
  }, 'Client');
  const serverButton = new FakeElement('button', {
    id: 'tab-server',
    'aria-pressed': 'false',
    class: 'btn btn-ghost pipeline-mode-tab',
    'data-pipeline': 'server',
  }, 'Server');
  const undoButton = new FakeElement('button', {
    id: 'btn-undo-pipeline',
  }, 'Undo');
  const redoButton = new FakeElement('button', {
    id: 'btn-redo-pipeline',
  }, 'Redo');
  const runButton = new FakeElement('button', {
    id: 'btn-run-pipeline',
  }, 'Run');
  const loadButton = new FakeElement('button', {
    id: 'btn-load-dag',
  }, 'Load');
  const saveButton = new FakeElement('button', {
    id: 'btn-save-dag',
  }, 'Save');
  const publishButton = new FakeElement('button', {
    id: 'btn-publish-pipeline',
  }, 'Publish');
  const fitButton = new FakeElement('button', {
    id: 'btn-fit-canvas',
  }, 'Fit');
  const zoomOutButton = new FakeElement('button', {
    id: 'btn-zoom-out',
  }, '-');
  const zoomInButton = new FakeElement('button', {
    id: 'btn-zoom-in',
  }, '+');
  const statusSummary = new FakeElement('span', {
    id: 'workbench-status-summary',
  }, 'Ready');
  const paletteToggle = new FakeElement('button', {
    id: 'btn-toggle-palette',
    'aria-label': 'Collapse palette',
  }, '‹');
  const paletteBody = new FakeElement(
    'div',
    {
      id: 'policy-palette',
      class: 'workbench-panel-body policy-palette',
    },
    '',
    [
      paletteItem('accept'),
      paletteItem('rate-limit'),
    ],
  );
  const palette = new FakeElement(
    'aside',
    {
      id: 'palette-panel',
      class: 'workbench-panel palette-panel',
    },
    '',
    [
      paletteToggle,
      paletteBody,
    ],
  );
  const canvasTitle = new FakeElement('span', {
    id: 'canvas-title',
  }, 'Client Pipeline');
  const zoomLabel = new FakeElement('span', {
    id: 'canvas-zoom-label',
  }, '100%');
  const edge = new FakeElement('path', {
    'data-edge-id': 'client-edge-1',
    'data-edge-from': 'client-start',
    'data-edge-from-port': 'next',
    'data-edge-to': 'client-node-1',
    'data-edge-to-port': 'in',
  });
  const startNode = new FakeElement('g', {
    'data-node-id': 'client-start',
    'data-node-policy': 'start',
    'data-node-type': 'start',
    'data-node-config': '{}',
  });
  const policyNode = new FakeElement('g', {
    'data-node-id': 'client-node-1',
    'data-node-policy': 'write-guard',
    'data-node-type': 'policy',
    'data-node-config': '{"require_auth":true}',
    transform: 'translate(260, 80)',
  });
  const standaloneNode = standalonePolicy
    ? new FakeElement('g', {
      'data-node-id': 'client-node-2',
      'data-node-policy': standalonePolicy,
      'data-node-type': 'policy',
      'data-node-config': '{}',
      transform: 'translate(520, 80)',
    })
    : null;
  const svg = new FakeElement(
    'svg',
    {
      id: 'pipeline-svg',
    },
    '',
    [edge, startNode, policyNode, standaloneNode, ...extraNodes].filter(Boolean),
  );
  const selectionMarquee = new FakeElement('div', {
    id: 'selection-marquee',
    class: 'selection-marquee',
  });
  const minimap = new FakeElement('svg', {
    id: 'minimap-svg',
    class: 'minimap-svg',
  });
  const canvas = new FakeElement(
    'div',
    {
      id: 'pipeline-canvas',
      class: 'pipeline-canvas',
    },
    '',
    [selectionMarquee, svg, minimap],
  );
  const workbench = new FakeElement(
    'div',
    {
      id: 'pipeline-workbench',
      class: 'pipeline-workbench',
    },
    '',
    [
      clientButton,
      serverButton,
      undoButton,
      redoButton,
      runButton,
      loadButton,
      saveButton,
      publishButton,
      fitButton,
      zoomOutButton,
      zoomInButton,
      statusSummary,
      palette,
      canvasTitle,
      zoomLabel,
      canvas,
    ],
  );

  return {
    canvasTitle,
    canvas,
    clientButton,
    loadButton,
    minimap,
    paletteToggle,
    policyNode,
    standaloneNode,
    publishButton,
    redoButton,
    runButton,
    saveButton,
    serverButton,
    svg,
    startNode,
    statusSummary,
    undoButton,
    workbench,
    zoomLabel,
  };
}

function blocklistFixture() {
  const loadingRow = () =>
    new FakeElement(
      'tr',
      {},
      '',
      [new FakeElement('td', { colspan: '2' }, 'Loading...')],
    );
  const refreshButton = new FakeElement('button', { id: 'btn-refresh' }, 'Refresh');
  const ipInput = new FakeElement('input', { id: 'ip-input', value: '' });
  const addIpButton = new FakeElement('button', { id: 'btn-add-ip' }, 'Add IP');
  const pubkeyInput = new FakeElement('input', { id: 'pubkey-input', value: '' });
  const addPubkeyButton = new FakeElement('button', { id: 'btn-add-pubkey' }, 'Add Pubkey');
  const ipTbody = new FakeElement('tbody', { id: 'ip-tbody' }, '', [loadingRow()]);
  const pubkeyTbody = new FakeElement('tbody', { id: 'pubkey-tbody' }, '', [loadingRow()]);
  const ipListContainer = new FakeElement(
    'div',
    { id: 'ip-list-container' },
    '',
    [new FakeElement('table', {}, '', [ipTbody])],
  );
  const pubkeyListContainer = new FakeElement(
    'div',
    { id: 'pubkey-list-container' },
    '',
    [new FakeElement('table', {}, '', [pubkeyTbody])],
  );

  return {
    addIpButton,
    addPubkeyButton,
    ipInput,
    ipListContainer,
    ipTbody,
    pubkeyInput,
    pubkeyListContainer,
    pubkeyTbody,
    refreshButton,
    nodes: [
      refreshButton,
      ipInput,
      addIpButton,
      pubkeyInput,
      addPubkeyButton,
      ipListContainer,
      pubkeyListContainer,
    ],
  };
}

function dashboardFixture() {
  const statsCards = new FakeElement('div', { id: 'stats-cards' });
  const chartTitle = new FakeElement('div', { class: 'chart-title' }, 'Connection Pressure');
  const progressBar = new FakeElement('div', { class: 'progress-bar' });
  const pressureText = new FakeElement('strong', {}, 'normal');
  const chartContainer = new FakeElement(
    'div',
    { class: 'chart-container' },
    '',
    [chartTitle, progressBar, pressureText],
  );
  const throughputBody = new FakeElement(
    'div',
    { id: 'throughput-chart-body' },
    '',
    [new FakeElement('span', { class: 'text-muted' }, 'Loading...')],
  );

  return {
    chartContainer,
    chartTitle,
    pressureText,
    progressBar,
    statsCards,
    throughputBody,
    nodes: [statsCards, chartContainer, throughputBody],
  };
}

function connectionsFixture() {
  const loadingRow = () =>
    new FakeElement(
      'tr',
      {},
      '',
      [new FakeElement('td', { colspan: '7' }, 'Loading...')],
    );
  const refreshButton = new FakeElement('button', { id: 'btn-refresh' }, 'Refresh');
  const bulkButton = new FakeElement('button', {
    id: 'btn-disconnect-selected',
    disabled: '',
  }, 'Disconnect Selected');
  const summaryTotal = new FakeElement('div', { id: 'summary-total' }, '—');
  const summaryAuthed = new FakeElement('div', { id: 'summary-authed' }, '—');
  const summaryUnauthed = new FakeElement('div', { id: 'summary-unauthed' }, '—');
  const searchInput = new FakeElement('input', { id: 'search-input', value: '' });
  const filterAll = new FakeElement('button', {
    class: 'btn btn-primary auth-filter-btn',
    'data-filter': 'all',
  }, 'All');
  const filterAuthenticated = new FakeElement('button', {
    class: 'btn btn-ghost auth-filter-btn',
    'data-filter': 'authenticated',
  }, 'Authenticated');
  const filterUnauthenticated = new FakeElement('button', {
    class: 'btn btn-ghost auth-filter-btn',
    'data-filter': 'unauthenticated',
  }, 'Unauthenticated');
  const selectAll = new FakeElement('input', { id: 'select-all' });
  const tbody = new FakeElement('tbody', { id: 'connections-tbody' }, '', [loadingRow()]);

  return {
    bulkButton,
    filterAll,
    filterAuthenticated,
    filterUnauthenticated,
    refreshButton,
    searchInput,
    selectAll,
    summaryAuthed,
    summaryTotal,
    summaryUnauthed,
    tbody,
    nodes: [
      refreshButton,
      bulkButton,
      summaryTotal,
      summaryAuthed,
      summaryUnauthed,
      searchInput,
      filterAll,
      filterAuthenticated,
      filterUnauthenticated,
      selectAll,
      tbody,
    ],
  };
}

function metricsFixture() {
  const range5 = new FakeElement('button', {
    class: 'btn btn-primary time-range-btn',
    'data-range': '5',
  }, '5m');
  const range60 = new FakeElement('button', {
    class: 'btn btn-ghost time-range-btn',
    'data-range': '60',
  }, '1h');
  const refreshButton = new FakeElement('button', { id: 'btn-refresh-metrics' }, 'Refresh');
  const throughputBody = new FakeElement(
    'div',
    { id: 'throughput-chart-body' },
    '',
    [new FakeElement('span', { class: 'text-muted' }, 'Loading...')],
  );
  const policyBody = new FakeElement(
    'div',
    { id: 'policy-decisions-body' },
    '',
    [new FakeElement('div', {}, 'Loading...')],
  );
  const connectionBody = new FakeElement(
    'div',
    { id: 'connection-chart-body' },
    '',
    [new FakeElement('span', { class: 'text-muted' }, 'Loading...')],
  );
  const rawToggle = new FakeElement('div', { id: 'raw-metrics-toggle' }, 'Raw Prometheus Metrics');
  const rawChevron = new FakeElement('span', { id: 'raw-metrics-chevron' }, '▶ Expand');
  const rawContent = new FakeElement('div', { id: 'raw-metrics-content' });
  rawContent.style.display = 'none';
  const rawSearch = new FakeElement('input', { id: 'raw-metrics-search', value: '' });
  const copyButton = new FakeElement('button', { id: 'btn-copy-metrics' }, 'Copy');
  const rawPre = new FakeElement(
    'pre',
    { id: 'raw-metrics-pre' },
    '',
    [new FakeElement('span', { class: 'text-muted' }, 'Loading...')],
  );

  return {
    connectionBody,
    copyButton,
    policyBody,
    range5,
    range60,
    rawChevron,
    rawContent,
    rawPre,
    rawSearch,
    rawToggle,
    refreshButton,
    throughputBody,
    nodes: [
      range5,
      range60,
      refreshButton,
      throughputBody,
      policyBody,
      connectionBody,
      rawToggle,
      rawChevron,
      rawContent,
      rawSearch,
      copyButton,
      rawPre,
    ],
  };
}

function logsFixture() {
  const refreshButton = new FakeElement('button', { id: 'btn-refresh-logs' }, 'Refresh');
  const pauseButton = new FakeElement('button', { id: 'btn-pause-logs' }, 'Pause');
  const clearButton = new FakeElement('button', { id: 'btn-clear-logs' }, 'Clear');
  const logCount = new FakeElement('span', { id: 'log-count-display' }, '0 lines');
  const emptyState = new FakeElement('div', { id: 'log-empty-state' }, 'No logs loaded');
  const viewer = new FakeElement('div', { id: 'log-viewer' }, '', [emptyState]);
  viewer.scrollTop = 0;
  viewer.clientHeight = 100;
  viewer.scrollHeight = 100;
  const status = new FakeElement('span', {
    id: 'log-stream-status',
    class: 'log-status log-status-connecting',
  }, 'connecting');
  const logLevel = new FakeElement('div', { id: 'log-level-display' }, '—');
  const runtimeInfo = new FakeElement(
    'tbody',
    { id: 'runtime-info-tbody' },
    '',
    [new FakeElement('tr', {}, '', [new FakeElement('td', { colspan: '2' }, 'Loading...')])],
  );

  return {
    clearButton,
    emptyState,
    logCount,
    logLevel,
    pauseButton,
    refreshButton,
    runtimeInfo,
    status,
    viewer,
    nodes: [
      refreshButton,
      pauseButton,
      clearButton,
      logCount,
      viewer,
      status,
      logLevel,
      runtimeInfo,
    ],
  };
}

Deno.test('fresh nav boot stores Fresh island boot arguments and mounts islands', async () => {
  const document = new FakeDocument();
  const window = new FakeWindow();
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();
    const mountCalls = [];
    const islands = {
      AdminIslandSmoke: {
        mount(root, props) {
          mountCalls.push({ root, props });
        },
      },
    };
    const initialProps = '[[1],{"slots":2,"props":3},[],{}]';
    const nextProps = '[]';

    boot(islands, initialProps);
    assertEquals(mountCalls.length, 1);
    assertStrictEquals(mountCalls[0].root, document);
    assertStrictEquals(mountCalls[0].props, initialProps);

    boot({}, nextProps);

    const args = globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;
    assertEquals(args?.islands, {});
    assertStrictEquals(args?.props, nextProps);
    assertEquals(document.listeners.map((entry) => entry.type), ['click']);
    assertEquals(window.listeners.map((entry) => entry.type), ['popstate']);
  } finally {
    restoreBootArgs();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot mounts the layout theme toggle', async () => {
  const themeMount = new FakeElement('div', { id: 'theme-toggle-mount' });
  const document = new FakeDocument({ childNodes: [themeMount] });
  document.documentElement = new FakeElement('html');
  const window = new FakeWindow();
  const stored = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreLocalStorage = setGlobal('localStorage', {
    getItem() {
      return null;
    },
    setItem(key, value) {
      stored.push([key, value]);
    },
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const button = themeMount.querySelector('.theme-toggle');
    assertEquals(button?.getAttribute('aria-label'), 'Toggle theme');
    assertEquals(button?.textContent, '☽');

    button.click();

    assertEquals(document.documentElement.getAttribute('data-theme'), 'dark');
    assertEquals(button.textContent, '☀');
    assertEquals(stored, [['pfortner-theme', 'dark']]);
  } finally {
    restoreBootArgs();
    restoreLocalStorage();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot mounts the explicit sidebar collapse toggle', async () => {
  const button = new FakeElement('button', {
    id: 'btn-toggle-sidebar',
    'aria-expanded': 'true',
  }, '‹');
  const document = new FakeDocument({ childNodes: [button] });
  document.documentElement = new FakeElement('html');
  const window = new FakeWindow();
  const stored = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreLocalStorage = setGlobal('localStorage', {
    getItem(key) {
      return key === 'pfortner-sidebar-collapsed' ? 'true' : null;
    },
    setItem(key, value) {
      stored.push([key, value]);
    },
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);

    assertEquals(
      document.documentElement.getAttribute('data-sidebar'),
      'collapsed',
    );
    assertEquals(button.getAttribute('aria-label'), 'Expand sidebar');
    assertEquals(button.getAttribute('aria-expanded'), 'false');
    assertEquals(button.textContent, '›');

    button.click();

    assertEquals(document.documentElement.getAttribute('data-sidebar'), null);
    assertEquals(button.getAttribute('aria-label'), 'Collapse sidebar');
    assertEquals(button.getAttribute('aria-expanded'), 'true');
    assertEquals(button.textContent, '‹');
    assertEquals(stored, [['pfortner-sidebar-collapsed', 'false']]);
  } finally {
    restoreBootArgs();
    restoreLocalStorage();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot initializes dashboard page behavior from the client entry', async () => {
  const fixture = dashboardFixture();
  const document = new FakeDocument({ childNodes: fixture.nodes });
  const window = new FakeWindow();
  const fetchCalls = [];
  const intervalIds = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreSetInterval = setGlobal('setInterval', (_listener, _delay) => {
    const id = intervalIds.length + 1;
    intervalIds.push(id);
    return id;
  });
  const restoreClearInterval = setGlobal('clearInterval', (_id) => {});
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/health/detail') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'ok',
            uptime_seconds: 65,
            connections: { active: 7, max: 10, pressure: 'high' },
            upstream: { status: 'ok', latency_ms: 12 },
            memory: { rss: 10485760, heapUsed: 5242880 },
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          { ts: Date.now(), accept: 3, reject: 1 },
        ]),
    });
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    await waitFor(() => fixture.statsCards.textContent.includes('Connections7Max: 10'));

    assertEquals(fetchCalls, [
      '/admin/api/health/detail',
      '/admin/api/metrics/throughput',
    ]);
    assertEquals(intervalIds, [1]);
    assertEquals(fixture.statsCards.textContent.includes('Uptime: 1m 5s'), true);
    assertEquals(fixture.chartTitle.textContent, 'Connection Pressure — 70% (7/10)');
    assertEquals(fixture.progressBar.getAttribute('class'), 'progress-bar progress-bar-warning');
    assertEquals(fixture.progressBar.style.width, '70%');
    assertEquals(fixture.pressureText.textContent, 'high');
    assertEquals(fixture.throughputBody.querySelector('svg') !== null, true);
  } finally {
    restoreBootArgs();
    restoreFetch();
    restoreClearInterval();
    restoreSetInterval();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot initializes metrics page behavior from the client entry', async () => {
  const fixture = metricsFixture();
  const document = new FakeDocument({ childNodes: fixture.nodes });
  const window = new FakeWindow();
  const now = Date.now();
  const throughputBuckets = [
    { ts: now - 1000, accept: 4, reject: 1 },
    { ts: now - 2000, accept: 1, reject: 2 },
  ];
  const prometheusText = [
    '# HELP pfortner_policy_decisions_total Policy decisions',
    'pfortner_policy_decisions_total{policy="write-guard",action="accept"} 7',
    'pfortner_policy_decisions_total{policy="write-guard",action="reject"} 2',
    'pfortner_policy_decisions_total{policy="rate-limit",action="next"} 3',
  ].join('\n');
  const fetchCalls = [];
  const copied = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreNavigator = setGlobal('navigator', {
    clipboard: {
      writeText(value) {
        copied.push(value);
        return Promise.resolve();
      },
    },
  });
  const restoreSetInterval = setGlobal('setInterval', () => 1);
  const restoreClearInterval = setGlobal('clearInterval', () => {});
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/metrics/throughput') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(throughputBuckets),
      });
    }
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(prometheusText),
    });
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    await waitFor(() => fixture.policyBody.textContent.includes('write-guard'));

    assertEquals(fetchCalls, [
      '/admin/api/metrics/throughput',
      '/admin/api/metrics/prometheus',
    ]);
    assertEquals(fixture.throughputBody.querySelector('svg') !== null, true);
    assertEquals(fixture.connectionBody.querySelector('svg') !== null, true);
    assertEquals(fixture.rawPre.textContent.includes('write-guard'), true);

    fixture.rawToggle.click();
    assertEquals(fixture.rawContent.style.display, 'block');
    assertEquals(fixture.rawChevron.textContent, '▼ Collapse');

    fixture.rawSearch.value = 'rate-limit';
    fixture.rawSearch.dispatchEvent({ type: 'input', target: fixture.rawSearch });
    assertEquals(fixture.rawPre.textContent.includes('rate-limit'), true);
    assertEquals(fixture.rawPre.textContent.includes('write-guard'), false);

    fixture.copyButton.click();
    await waitFor(() => copied.length === 1);
    assertEquals(copied, [prometheusText]);
  } finally {
    restoreBootArgs();
    restoreFetch();
    restoreClearInterval();
    restoreSetInterval();
    restoreNavigator();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot initializes logs page behavior from the client entry', async () => {
  const fixture = logsFixture();
  const document = new FakeDocument({ childNodes: fixture.nodes });
  const window = new FakeWindow();
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/config') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            infra: { metrics: { logging: { level: 'debug' } } },
          }),
      });
    }
    if (url === '/admin/api/health/detail') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'ok',
            uptime_seconds: 65,
            connections: { active: 2 },
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          logs: [
            {
              id: 1,
              line: JSON.stringify({
                timestamp: '2026-06-10T12:00:00.000Z',
                level: 'info',
                message: 'relay started',
                connectionId: 'conn-1',
              }),
              received_at: '2026-06-10T12:00:00.000Z',
            },
          ],
        }),
    });
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    await waitFor(() => fixture.viewer.textContent.includes('relay started'));

    assertEquals(fixture.logLevel.textContent, 'debug');
    assertEquals(fixture.runtimeInfo.textContent.includes('Uptime1m 5s'), true);
    assertEquals(fixture.status.textContent, 'fallback');
    assertEquals(fixture.logCount.textContent, '1 line');
    assertEquals(fixture.emptyState.style.display, 'none');
    assertEquals(fetchCalls.includes('/admin/api/logs?limit=200'), true);

    fixture.pauseButton.click();
    await waitFor(() => fixture.pauseButton.textContent === 'Resume');
    await waitFor(() => fetchCalls.length >= 8);
    assertEquals(fixture.status.textContent, 'paused');

    fixture.clearButton.click();
    assertEquals(fixture.logCount.textContent, '0 lines');
    assertEquals(fixture.emptyState.style.display, 'block');
  } finally {
    restoreBootArgs();
    restoreFetch();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot initializes config page behavior from the client entry', async () => {
  const refreshButton = new FakeElement('button', { id: 'btn-refresh-config' }, 'Refresh');
  const reloadButton = new FakeElement('button', { id: 'btn-reload-config' }, 'Reload Config');
  const status = new FakeElement('div', { id: 'config-status' });
  const configJson = new FakeElement('pre', { id: 'config-json' }, 'Loading...');
  const document = new FakeDocument({
    childNodes: [refreshButton, reloadButton, status, configJson],
  });
  const window = new FakeWindow();
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push([url, init.method ?? 'GET']);
    if (url === '/admin/api/reload') {
      return Promise.resolve({
        ok: true,
        status: 200,
        type: 'basic',
        json: () => Promise.resolve({ ok: true }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ server: { port: 3000 } }),
    });
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    await waitFor(() => configJson.textContent.includes('"server"'));
    refreshButton.click();
    await waitFor(() => fetchCalls.length >= 2);
    reloadButton.click();
    await waitFor(() => reloadButton.textContent === '\u21bb Reload Config');

    assertEquals(fetchCalls, [
      ['/admin/api/config', 'GET'],
      ['/admin/api/config', 'GET'],
      ['/admin/api/reload', 'POST'],
      ['/admin/api/config', 'GET'],
    ]);
    assertEquals(status.querySelector('.badge-success')?.textContent.includes('Config reloaded successfully'), true);
    assertEquals(configJson.textContent.includes('"port": 3000'), true);
  } finally {
    restoreBootArgs();
    restoreFetch();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot initializes connections page behavior from the client entry', async () => {
  const fixture = connectionsFixture();
  const document = new FakeDocument({ childNodes: fixture.nodes });
  const window = new FakeWindow();
  const state = {
    connections: [
      {
        id: 'conn-authenticated',
        ip: '203.0.113.1',
        authenticated: true,
        pubkey: 'abcdef1234567890',
        connectedAt: new Date(Date.now() - 3000).toISOString(),
      },
      {
        id: 'conn-guest',
        ip: '198.51.100.9',
        authenticated: false,
        pubkey: '',
        connectedAt: null,
      },
    ],
  };
  const fetchCalls = [];
  const alerts = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreAlert = setGlobal('alert', (message) => alerts.push(message));
  const restoreConfirm = setGlobal('confirm', () => true);
  const restoreSetInterval = setGlobal('setInterval', () => 1);
  const restoreClearInterval = setGlobal('clearInterval', () => {});
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push([url, init.method ?? 'GET', init.body ?? null]);
    if (url === '/admin/api/connections/disconnect-batch' && init.method === 'POST') {
      const ids = JSON.parse(init.body).ids;
      state.connections = state.connections.filter((connection) => !ids.includes(connection.id));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ connections: state.connections }),
    });
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    await waitFor(() => fixture.tbody.textContent.includes('203.0.113.1'));

    assertEquals(fixture.summaryTotal.textContent, '2');
    assertEquals(fixture.summaryAuthed.textContent, '1');
    assertEquals(fixture.summaryUnauthed.textContent, '1');

    fixture.searchInput.value = '198.51.100.9';
    fixture.searchInput.dispatchEvent({ type: 'input', target: fixture.searchInput });
    assertEquals(fixture.tbody.textContent.includes('conn-auth'), false);
    assertEquals(fixture.tbody.textContent.includes('198.51.100.9'), true);

    fixture.filterAuthenticated.click();
    assertEquals(fixture.tbody.textContent, 'No connections');

    fixture.filterAll.click();
    fixture.searchInput.value = '';
    fixture.searchInput.dispatchEvent({ type: 'input', target: fixture.searchInput });
    const disconnectButton = fixture.tbody.querySelector('.btn-disconnect');
    disconnectButton.click();
    await waitFor(() => fixture.summaryTotal.textContent === '1');

    assertEquals(fixture.summaryTotal.textContent, '1');
    assertEquals(fixture.summaryAuthed.textContent, '0');
    assertEquals(fixture.summaryUnauthed.textContent, '1');
    assertEquals(fetchCalls.map(([url, method]) => [url, method]), [
      ['/admin/api/connections', 'GET'],
      ['/admin/api/connections/disconnect-batch', 'POST'],
      ['/admin/api/connections', 'GET'],
    ]);
    assertEquals(alerts, []);
  } finally {
    restoreBootArgs();
    restoreFetch();
    restoreClearInterval();
    restoreSetInterval();
    restoreConfirm();
    restoreAlert();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav boot initializes blocklist page behavior from the client entry', async () => {
  const fixture = blocklistFixture();
  const document = new FakeDocument({ childNodes: fixture.nodes });
  const window = new FakeWindow();
  const state = {
    ips: ['203.0.113.10'],
    pubkeys: ['pk-blocked'],
  };
  const fetchCalls = [];
  const alerts = [];
  const restoreDocument = setGlobal('document', document);
  const restoreWindow = setGlobal('window', window);
  const restoreAlert = setGlobal('alert', (message) => alerts.push(message));
  const restoreConfirm = setGlobal('confirm', () => true);
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push([url, init.method ?? 'GET', init.body ?? null]);
    if (url === '/admin/api/blocklist/ip' && init.method === 'POST') {
      state.ips.push(JSON.parse(init.body).ip);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    if (url === '/admin/api/blocklist/pubkey/pk-blocked' && init.method === 'DELETE') {
      state.pubkeys = state.pubkeys.filter((value) => value !== 'pk-blocked');
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ips: state.ips, pubkeys: state.pubkeys }),
    });
  });
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    await waitFor(() => fixture.ipTbody.textContent.includes('203.0.113.10'));

    fixture.ipInput.value = '198.51.100.7';
    fixture.addIpButton.click();
    await waitFor(() => fixture.ipTbody.textContent.includes('198.51.100.7'));

    const removePubkeyButton = fixture.pubkeyTbody.querySelector('.btn-danger');
    removePubkeyButton.click();
    await waitFor(() => fixture.pubkeyTbody.textContent.includes('No entries'));

    assertEquals(fetchCalls.map(([url, method]) => [url, method]), [
      ['/admin/api/blocklist', 'GET'],
      ['/admin/api/blocklist/ip', 'POST'],
      ['/admin/api/blocklist', 'GET'],
      ['/admin/api/blocklist/pubkey/pk-blocked', 'DELETE'],
      ['/admin/api/blocklist', 'GET'],
    ]);
    assertEquals(fixture.ipInput.value, '');
    assertEquals(alerts, []);
  } finally {
    restoreBootArgs();
    restoreFetch();
    restoreConfirm();
    restoreAlert();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav mounts island modules introduced by partial navigation', async () => {
  const currentDocument = new FakeDocument({
    title: 'Blocklist',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const smokeButton = new FakeElement('button', {
    'data-admin-island-smoke': 'true',
  });
  smokeButton.textContent = 'Island smoke 0';
  const nextDocument = new FakeDocument({
    title: 'Pipelines',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      smokeButton,
      new FakeComment('/frsh:partial'),
    ],
    moduleElements: [
      new FakeElement('script', {
        type: 'module',
      }, 'import AdminIslandSmoke from "/admin/static/islands/AdminIslandSmoke.js";'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/blocklist',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const historyCalls = [];
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      historyCalls.push(['push', url]);
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      historyCalls.push(['replace', url]);
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreFetch = setGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/pipelines',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    }));
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/pipelines',
      'f-client-nav': 'true',
    });
    let defaultPrevented = false;

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {
        defaultPrevented = true;
      },
    });

    await waitFor(() =>
      currentDocument.querySelector('[data-admin-island-smoke="true"]')
        ?.dataset.mounted === 'true'
    );
    const mountedButton = currentDocument.querySelector(
      '[data-admin-island-smoke="true"]',
    );
    mountedButton.click();

    assertEquals(defaultPrevented, true);
    assertEquals(historyCalls, [['push', 'http://localhost/admin/pipelines']]);
    assertEquals(location.assignCalls, []);
    assertEquals(mountedButton.dataset.count, '1');
    assertEquals(mountedButton.textContent, 'Island smoke 1');
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav mounts island modules from partial navigation Link header', async () => {
  const currentDocument = new FakeDocument({
    title: 'Blocklist',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const smokeButton = new FakeElement('button', {
    'data-admin-island-smoke': 'true',
  });
  smokeButton.textContent = 'Island smoke 0';
  const nextDocument = new FakeDocument({
    title: 'Pipelines',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      smokeButton,
      new FakeComment('/frsh:partial'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/blocklist',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreFetch = setGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/pipelines',
      headers: {
        get(name) {
          if (name !== 'Link') return null;
          return '</admin/static/islands/AdminIslandSmoke.js>; rel="modulepreload"; as="script"';
        },
      },
      text: () => Promise.resolve('<html></html>'),
    }));
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/pipelines',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() =>
      currentDocument.querySelector('[data-admin-island-smoke="true"]')
        ?.dataset.mounted === 'true'
    );
    const mountedButton = currentDocument.querySelector(
      '[data-admin-island-smoke="true"]',
    );
    mountedButton.click();

    assertEquals(location.assignCalls, []);
    assertEquals(mountedButton.dataset.count, '1');
    assertEquals(mountedButton.textContent, 'Island smoke 1');
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav initializes logs behavior after partial navigation without a page script', async () => {
  const currentDocument = new FakeDocument({
    title: 'Metrics',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const fixture = logsFixture();
  const nextDocument = new FakeDocument({
    title: 'Logs',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      ...fixture.nodes,
      new FakeComment('/frsh:partial'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/metrics',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/config') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ infra: { metrics: { logging: { level: 'info' } } } }),
      });
    }
    if (url === '/admin/api/health/detail') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'draining',
            uptime_seconds: 5,
            connections: { active: 1 },
          }),
      });
    }
    if (url === '/admin/api/logs?limit=200') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            logs: [
              {
                id: 2,
                line: '2026-06-10T12:00:01.000Z WARN partial fallback',
                received_at: '2026-06-10T12:00:01.000Z',
              },
            ],
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/logs',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    });
  });
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/logs',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() => currentDocument.querySelector('#log-viewer')?.textContent.includes('partial fallback'));

    assertEquals(fetchCalls[0], 'http://localhost/admin/logs');
    assertEquals(fetchCalls.includes('/admin/api/logs?limit=200'), true);
    assertEquals(location.assignCalls, []);
    assertEquals(currentDocument.querySelector('#log-stream-status')?.textContent, 'fallback');
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav initializes metrics behavior after partial navigation without a page script', async () => {
  const currentDocument = new FakeDocument({
    title: 'Connections',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const fixture = metricsFixture();
  const nextDocument = new FakeDocument({
    title: 'Metrics',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      ...fixture.nodes,
      new FakeComment('/frsh:partial'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/connections',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreSetInterval = setGlobal('setInterval', () => 1);
  const restoreClearInterval = setGlobal('clearInterval', () => {});
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/metrics/throughput') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (url === '/admin/api/metrics/prometheus') {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('pfortner_policy_decisions_total{policy="route",action="accept"} 1'),
      });
    }
    return Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/metrics',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    });
  });
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/metrics',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() => currentDocument.querySelector('#policy-decisions-body')?.textContent.includes('route'));

    assertEquals(fetchCalls, [
      'http://localhost/admin/metrics',
      '/admin/api/metrics/throughput',
      '/admin/api/metrics/prometheus',
    ]);
    assertEquals(location.assignCalls, []);
    assertEquals(
      currentDocument.querySelector('#throughput-chart-body')?.textContent,
      'No throughput data available',
    );
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreClearInterval();
    restoreSetInterval();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav initializes config behavior after partial navigation without a page script', async () => {
  const currentDocument = new FakeDocument({
    title: 'Blocklist',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const nextDocument = new FakeDocument({
    title: 'Config',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('button', { id: 'btn-refresh-config' }, 'Refresh'),
      new FakeElement('button', { id: 'btn-reload-config' }, 'Reload Config'),
      new FakeElement('div', { id: 'config-status' }),
      new FakeElement('pre', { id: 'config-json' }, 'Loading...'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/blocklist',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/config') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ admin: { enabled: true } }),
      });
    }
    return Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/config',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    });
  });
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/config',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() => currentDocument.querySelector('#config-json')?.textContent.includes('"admin"'));

    assertEquals(fetchCalls, [
      'http://localhost/admin/config',
      '/admin/api/config',
    ]);
    assertEquals(location.assignCalls, []);
    assertEquals(currentDocument.querySelector('#config-status') !== null, true);
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav initializes connections behavior after partial navigation without a page script', async () => {
  const currentDocument = new FakeDocument({
    title: 'Dashboard',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const fixture = connectionsFixture();
  const nextDocument = new FakeDocument({
    title: 'Connections',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      ...fixture.nodes,
      new FakeComment('/frsh:partial'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreSetInterval = setGlobal('setInterval', () => 1);
  const restoreClearInterval = setGlobal('clearInterval', () => {});
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/connections') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            connections: [
              {
                id: 'conn-from-partial',
                ip: '203.0.113.88',
                authenticated: true,
                pubkey: 'pk-from-partial',
                connectedAt: null,
              },
            ],
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/connections',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    });
  });
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/connections',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() => currentDocument.querySelector('#connections-tbody')?.textContent.includes('203.0.113.88'));

    assertEquals(fetchCalls, [
      'http://localhost/admin/connections',
      '/admin/api/connections',
    ]);
    assertEquals(location.assignCalls, []);
    assertEquals(currentDocument.querySelector('#summary-total')?.textContent, '1');
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreClearInterval();
    restoreSetInterval();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav initializes dashboard behavior after partial navigation without a page script', async () => {
  const currentDocument = new FakeDocument({
    title: 'Config',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const fixture = dashboardFixture();
  const nextDocument = new FakeDocument({
    title: 'Dashboard',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      ...fixture.nodes,
      new FakeComment('/frsh:partial'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/config',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreSetInterval = setGlobal('setInterval', () => 1);
  const restoreClearInterval = setGlobal('clearInterval', () => {});
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/health/detail') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'draining',
            uptime_seconds: 5,
            connections: { active: 2, max: 20, pressure: 'normal' },
            upstream: { status: 'offline', latency_ms: null },
            memory: null,
          }),
      });
    }
    if (url === '/admin/api/metrics/throughput') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    return Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    });
  });
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() => currentDocument.querySelector('#stats-cards')?.textContent.includes('Draining'));

    assertEquals(fetchCalls, [
      'http://localhost/admin/',
      '/admin/api/health/detail',
      '/admin/api/metrics/throughput',
    ]);
    assertEquals(location.assignCalls, []);
    assertEquals(currentDocument.querySelector('#throughput-chart-body')?.textContent, 'No throughput data available');
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreClearInterval();
    restoreSetInterval();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav initializes blocklist behavior after partial navigation without a page script', async () => {
  const currentDocument = new FakeDocument({
    title: 'Config',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const fixture = blocklistFixture();
  const nextDocument = new FakeDocument({
    title: 'Blocklist',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      ...fixture.nodes,
      new FakeComment('/frsh:partial'),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/config',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const fetchCalls = [];
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreFetch = setGlobal('fetch', (url) => {
    fetchCalls.push(url);
    if (url === '/admin/api/blocklist') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ips: ['203.0.113.42'],
            pubkeys: ['pk-from-partial'],
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/blocklist',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    });
  });
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/blocklist',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() => currentDocument.querySelector('#ip-tbody')?.textContent.includes('203.0.113.42'));

    assertEquals(fetchCalls, [
      'http://localhost/admin/blocklist',
      '/admin/api/blocklist',
    ]);
    assertEquals(location.assignCalls, []);
    assertEquals(currentDocument.querySelector('#pubkey-tbody')?.textContent.includes('pk-from-partial'), true);
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('fresh nav mounts PipelineWorkbench island introduced by partial navigation', async () => {
  const serializedWorkbenchProps = JSON.stringify([
    [1],
    { slots: 2, props: 3 },
    [],
    { initialPipelines: 4, initialPlugins: 9 },
    { client: 5, server: 8 },
    [6],
    { policy: 7 },
    'accept',
    [],
    [7, 10],
    'write-guard',
  ]);
  const currentDocument = new FakeDocument({
    title: 'Blocklist',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      new FakeElement('div'),
      new FakeComment('/frsh:partial'),
    ],
  });
  const workbench = new FakeElement('div', {
    id: 'pipeline-workbench',
  });
  const nextDocument = new FakeDocument({
    title: 'Pipelines',
    childNodes: [
      new FakeComment('frsh:partial:admin-content'),
      workbench,
      new FakeComment('/frsh:partial'),
    ],
    moduleElements: [
      new FakeElement(
        'script',
        {
          type: 'module',
        },
        `import { boot } from "/admin/static/fresh_nav.js";
import PipelineWorkbench from "/admin/static/islands/PipelineWorkbench.js";
boot({PipelineWorkbench},${JSON.stringify(serializedWorkbenchProps)});`,
      ),
    ],
  });
  const window = new FakeWindow();
  const location = {
    href: 'http://localhost/admin/blocklist',
    origin: 'http://localhost',
    assignCalls: [],
    assign(url) {
      this.assignCalls.push(url);
    },
  };
  const restoreDocument = setGlobal('document', currentDocument);
  const restoreWindow = setGlobal('window', window);
  const restoreNode = setGlobal('Node', { ELEMENT_NODE: 1, COMMENT_NODE: 8 });
  const restoreNodeFilter = setGlobal('NodeFilter', { SHOW_COMMENT: 128 });
  const restoreLocation = setGlobal('location', location);
  const restoreHistory = setGlobal('history', {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
    },
  });
  const restoreFetch = setGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      url: 'http://localhost/admin/pipelines',
      headers: { get: () => null },
      text: () => Promise.resolve('<html></html>'),
    }));
  const restoreParser = setGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return nextDocument;
      }
    },
  );
  const restoreBootArgs = setGlobal(
    '__PFORTNER_FRESH_ISLAND_BOOT_ARGS__',
    undefined,
  );
  delete globalThis.__PFORTNER_FRESH_ISLAND_BOOT_ARGS__;

  try {
    const { boot } = await importFreshNav();

    boot({}, []);
    const clickListener = currentDocument.listeners.find((entry) => entry.type === 'click')?.listener;
    const anchor = new FakeElement('a', {
      href: 'http://localhost/admin/pipelines',
      'f-client-nav': 'true',
    });

    clickListener({
      target: anchor,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });

    await waitFor(() =>
      currentDocument.querySelector('#pipeline-workbench')
        ?.dataset.mounted === 'true'
    );

    assertEquals(location.assignCalls, []);
    assertEquals(
      currentDocument.querySelector('#pipeline-workbench')?.dataset.mounted,
      'true',
    );
    assertEquals(
      currentDocument.querySelector('[data-node-policy="accept"]') !== null,
      true,
    );
  } finally {
    restoreBootArgs();
    restoreParser();
    restoreFetch();
    restoreHistory();
    restoreLocation();
    restoreNodeFilter();
    restoreNode();
    restoreWindow();
    restoreDocument();
  }
});

Deno.test('admin island smoke static chunk exports a mountable module', async () => {
  const mod = await import(
    `./islands/AdminIslandSmoke.js?test=${crypto.randomUUID()}`
  );

  assertEquals(typeof mod.default, 'function');
  assertEquals(typeof mod.default.mount, 'function');
});

Deno.test('PipelineWorkbench static chunk exports a mountable module', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );

  assertEquals(typeof mod.default, 'function');
  assertEquals(typeof mod.default.mount, 'function');
});

Deno.test('fresh nav does not keep page-local static script initializer registry', async () => {
  const source = await Deno.readTextFile(new URL('../client/fresh_nav.js', import.meta.url));
  const removedPipelinesScript = '/admin/static/' + 'pipelines.js';
  const removedPipelinesInitializer = 'init' + 'PipelinesPage';

  assertEquals(source.includes(removedPipelinesScript), false);
  assertEquals(source.includes(removedPipelinesInitializer), false);
  assertEquals(source.includes('PAGE_INITIALIZERS'), false);
  assertEquals(source.includes('initializePageModules'), false);
});
