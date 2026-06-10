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

class FakeElement {
  nodeType = 1;
  parentNode = null;
  parentElement = null;
  nextSibling = null;
  childNodes = [];
  listeners = [];
  dataset = {};
  textContent = '';

  constructor(tagName, attributes = {}, textContent = '', childNodes = []) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.href = attributes.href;
    this.target = attributes.target ?? '';
    this.value = attributes.value ?? '';
    this.textContent = textContent;
    this.disabled = Object.hasOwn(attributes, 'disabled');
    this.setChildNodes(childNodes);
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
      if (type === event.type) listener({ target: this, currentTarget: this, ...event });
    }
  }

  clone() {
    const clone = new FakeElement(
      this.tagName,
      Object.fromEntries(this.attributes),
      this.textContent,
      this.childNodes.map((node) => node.clone()),
    );
    clone.dataset = { ...this.dataset };
    return clone;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
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

async function importFreshNav() {
  return await import(`./fresh_nav.js?test=${crypto.randomUUID()}`);
}

async function waitFor(predicate) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

function pipelineWorkbenchFixture() {
  const clientButton = new FakeElement('button', {
    id: 'tab-client',
    'aria-pressed': 'true',
  }, 'Client');
  const serverButton = new FakeElement('button', {
    id: 'tab-server',
    'aria-pressed': 'false',
  }, 'Server');
  const undoButton = new FakeElement('button', {
    id: 'btn-undo-pipeline',
  }, 'Undo');
  const redoButton = new FakeElement('button', {
    id: 'btn-redo-pipeline',
  }, 'Redo');
  const loadButton = new FakeElement('button', {
    id: 'btn-load-dag',
  }, 'Load');
  const saveButton = new FakeElement('button', {
    id: 'btn-save-dag',
  }, 'Save');
  const publishButton = new FakeElement('button', {
    id: 'btn-publish-pipeline',
  }, 'Publish');
  const statusSummary = new FakeElement('span', {
    id: 'workbench-status-summary',
  }, 'Ready');
  const paletteToggle = new FakeElement('button', {
    id: 'btn-toggle-palette',
    'aria-label': 'Collapse palette',
  }, '‹');
  const palette = new FakeElement(
    'aside',
    {
      id: 'palette-panel',
      class: 'workbench-panel palette-panel',
    },
    '',
    [paletteToggle],
  );
  const canvasTitle = new FakeElement('span', {
    id: 'canvas-title',
  }, 'Client Pipeline');
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
  });
  const canvas = new FakeElement(
    'svg',
    {
      id: 'pipeline-svg',
    },
    '',
    [edge, startNode, policyNode],
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
      loadButton,
      saveButton,
      publishButton,
      statusSummary,
      palette,
      canvasTitle,
      canvas,
    ],
  );

  return {
    canvasTitle,
    clientButton,
    loadButton,
    paletteToggle,
    policyNode,
    publishButton,
    redoButton,
    saveButton,
    serverButton,
    startNode,
    statusSummary,
    undoButton,
    workbench,
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
        mount(root) {
          mountCalls.push(root);
        },
      },
    };
    const initialProps = '[[1],{"slots":2,"props":3},[],{}]';
    const nextProps = '[]';

    boot(islands, initialProps);
    assertEquals(mountCalls.length, 1);
    assertStrictEquals(mountCalls[0], document);

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

Deno.test('fresh nav mounts PipelineWorkbench island introduced by partial navigation', async () => {
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
      new FakeElement('script', {
        type: 'module',
      }, 'import PipelineWorkbench from "/admin/static/islands/PipelineWorkbench.js";'),
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

Deno.test('PipelineWorkbench static chunk wires shell controls', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });

  mod.default.mount(document);
  fixture.serverButton.click();

  assertEquals(fixture.clientButton.getAttribute('aria-pressed'), 'false');
  assertEquals(fixture.serverButton.getAttribute('aria-pressed'), 'true');
  assertEquals(fixture.canvasTitle.textContent, 'Server Pipeline');

  fixture.paletteToggle.click();

  assertEquals(
    fixture.workbench.getAttribute('class')?.includes('palette-collapsed'),
    true,
  );
  assertEquals(fixture.paletteToggle.getAttribute('aria-label'), 'Expand palette');
  assertEquals(fixture.paletteToggle.textContent, '›');
});

Deno.test('PipelineWorkbench static chunk opens playground modal from start node double click', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });

  mod.default.mount(document);
  fixture.startNode.dispatchEvent({ type: 'dblclick' });

  assertEquals(document.querySelector('.modal-backdrop') !== null, true);
  assertEquals(document.querySelector('.workbench-modal')?.getAttribute('role'), 'dialog');
  assertEquals(document.querySelector('#playground-message-input') !== null, true);
  assertEquals(document.querySelector('.playground-result-panel')?.textContent, 'No result yet.');
});

Deno.test('PipelineWorkbench static chunk validates settings modal JSON locally', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });

  mod.default.mount(document);
  fixture.policyNode.dispatchEvent({ type: 'dblclick' });

  const textarea = document.querySelector('textarea');
  const applyButton = document.querySelector('[data-modal-action="apply-settings"]');
  assertEquals(document.querySelector('.modal-backdrop') !== null, true);
  assertMatch(textarea?.value ?? '', /require_auth/);

  textarea.value = '[]';
  applyButton.click();

  assertMatch(document.querySelector('.modal-error')?.textContent ?? '', /Config JSON must be an object/);
  assertEquals(document.querySelector('.modal-backdrop') !== null, true);

  textarea.value = '{"require_auth":false}';
  applyButton.click();

  assertEquals(document.querySelector('.modal-backdrop'), null);
  assertEquals(fixture.policyNode.getAttribute('data-node-config'), '{"require_auth":false}');
});

Deno.test('PipelineWorkbench static chunk opens publish modal from toolbar button', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });

  mod.default.mount(document);
  fixture.publishButton.click();

  await waitFor(() => document.querySelector('.modal-backdrop') !== null);
  assertEquals(document.querySelector('.modal-backdrop') !== null, true);
  assertMatch(document.querySelector('.yaml-preview')?.textContent ?? '', /pipelines:/);
  assertMatch(document.querySelector('.yaml-preview')?.textContent ?? '', /write-guard/);
  assertEquals(
    document.querySelectorAll('.text-muted').some((element) => element.textContent === 'Writes active config'),
    true,
  );
});

Deno.test('PipelineWorkbench static chunk saves rendered graph through draft API', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const savedItems = new Map();
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({
      url,
      init,
      body: JSON.parse(init.body ?? '{}'),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'saved' }), { status: 200 }),
    );
  });
  const restoreStorage = setGlobal('localStorage', {
    getItem(key) {
      return savedItems.get(key) ?? null;
    },
    setItem(key, value) {
      savedItems.set(key, value);
    },
  });

  try {
    mod.default.mount(document);
    fixture.saveButton.click();

    await waitFor(() =>
      fetchCalls.some((call) => call.url === '/admin/api/pipeline-draft' && call.init.method === 'POST') &&
      fixture.statusSummary.textContent === 'DAG saved'
    );

    const saveCall = fetchCalls.find((call) => call.url === '/admin/api/pipeline-draft' && call.init.method === 'POST');
    assertEquals(saveCall.url, '/admin/api/pipeline-draft');
    assertEquals(saveCall.body.draft.graphs.client.nodes.some((node) => node.policy === 'write-guard'), true);
    assertEquals(savedItems.has('pfortner.pipelineWorkbenchDraft.v1'), true);
    assertEquals(fixture.statusSummary.textContent, 'DAG saved');
  } finally {
    restoreStorage();
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk waits for initial load before saving', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  let resolveConfig;
  let resolveDraft;
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({
      url,
      init,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (url === '/admin/api/config') {
      return new Promise((resolve) => {
        resolveConfig = () =>
          resolve(
            new Response(
              JSON.stringify({
                pipelines: {
                  client: [{ policy: 'write-guard', config: { require_auth: true } }],
                  server: [{ policy: 'rate-limit' }],
                },
              }),
              { status: 200 },
            ),
          );
      });
    }
    if (url === '/admin/api/pipeline-draft' && init.method !== 'POST') {
      return new Promise((resolve) => {
        resolveDraft = () =>
          resolve(
            new Response(JSON.stringify({ draft: null }), { status: 200 }),
          );
      });
    }
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'saved' }), { status: 200 }),
    );
  });
  const restoreStorage = setGlobal('localStorage', {
    getItem() {
      return null;
    },
    setItem() {},
  });

  try {
    mod.default.mount(document);
    fixture.saveButton.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(
      fetchCalls.some((call) => call.url === '/admin/api/pipeline-draft' && call.init.method === 'POST'),
      false,
    );

    resolveConfig();
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveDraft();

    await waitFor(() =>
      fetchCalls.some((call) => call.url === '/admin/api/pipeline-draft' && call.init.method === 'POST')
    );

    const saveCall = fetchCalls.find((call) => call.url === '/admin/api/pipeline-draft' && call.init.method === 'POST');
    assertEquals(saveCall.body.draft.graphs.server.nodes.some((node) => node.policy === 'rate-limit'), true);
  } finally {
    restoreStorage();
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk loads saved graph through draft API', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const draft = {
    version: 1,
    graphs: {
      client: {
        direction: 'client',
        nodes: [
          { id: 'client-start', type: 'start', policy: 'start' },
          { id: 'client-node-1', type: 'policy', policy: 'accept' },
        ],
        edges: [
          {
            id: 'client-edge-1',
            from: 'client-start',
            fromPort: 'next',
            to: 'client-node-1',
            toPort: 'in',
          },
        ],
      },
      server: { direction: 'server', nodes: [], edges: [] },
    },
    viewports: {},
    updatedAt: '1970-01-01T00:00:01.000Z',
    lastPublishedFingerprint: '',
  };
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify({ draft }), { status: 200 }),
    );
  });
  const restoreStorage = setGlobal('localStorage', {
    getItem() {
      return null;
    },
    setItem() {},
  });

  try {
    mod.default.mount(document);
    fixture.loadButton.click();

    await waitFor(() =>
      fetchCalls.some((call) => call.url === '/admin/api/pipeline-draft') &&
      fixture.statusSummary.textContent === 'Loaded saved DAG'
    );

    assertEquals(fetchCalls.some((call) => call.url === '/admin/api/pipeline-draft'), true);
    assertEquals(fixture.statusSummary.textContent, 'Loaded saved DAG');
    assertEquals(
      [...document.querySelectorAll('[data-node-id]')].some((node) =>
        node.getAttribute('data-node-policy') === 'accept'
      ),
      true,
    );
  } finally {
    restoreStorage();
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk saves loaded draft graph instead of stale DOM', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const draft = {
    version: 1,
    graphs: {
      client: {
        direction: 'client',
        nodes: [
          { id: 'client-start', type: 'start', policy: 'start' },
          { id: 'client-node-1', type: 'policy', policy: 'accept' },
        ],
        edges: [
          {
            id: 'client-edge-1',
            from: 'client-start',
            fromPort: 'next',
            to: 'client-node-1',
            toPort: 'in',
          },
        ],
      },
      server: {
        direction: 'server',
        nodes: [
          { id: 'server-start', type: 'start', policy: 'start' },
          { id: 'server-node-1', type: 'policy', policy: 'rate-limit' },
        ],
        edges: [
          {
            id: 'server-edge-1',
            from: 'server-start',
            fromPort: 'next',
            to: 'server-node-1',
            toPort: 'in',
          },
        ],
      },
    },
    viewports: {},
    updatedAt: '1970-01-01T00:00:01.000Z',
    lastPublishedFingerprint: '',
  };
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({
      url,
      init,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (url === '/admin/api/pipeline-draft' && init.method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'saved' }), { status: 200 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ draft }), { status: 200 }),
    );
  });
  const restoreStorage = setGlobal('localStorage', {
    getItem() {
      return null;
    },
    setItem() {},
  });

  try {
    mod.default.mount(document);
    fixture.loadButton.click();
    await waitFor(() => fixture.statusSummary.textContent === 'Loaded saved DAG');

    fixture.saveButton.click();
    await waitFor(() => fetchCalls.some((call) => call.init.method === 'POST'));

    const saveCall = fetchCalls.find((call) => call.init.method === 'POST');
    assertEquals(saveCall.url, '/admin/api/pipeline-draft');
    assertEquals(
      saveCall.body.draft.graphs.client.nodes.some((node) => node.policy === 'accept'),
      true,
    );
    assertEquals(
      saveCall.body.draft.graphs.server.nodes.some((node) => node.policy === 'rate-limit'),
      true,
    );
  } finally {
    restoreStorage();
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk loads local draft when server draft is invalid', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const localDraft = {
    version: 1,
    graphs: {
      client: {
        direction: 'client',
        nodes: [
          { id: 'client-start', type: 'start', policy: 'start' },
          { id: 'client-node-1', type: 'policy', policy: 'accept' },
        ],
        edges: [
          {
            id: 'client-edge-1',
            from: 'client-start',
            fromPort: 'next',
            to: 'client-node-1',
            toPort: 'in',
          },
        ],
      },
      server: { direction: 'server', nodes: [{ id: 'server-start', type: 'start', policy: 'start' }], edges: [] },
    },
    viewports: {},
    updatedAt: '1970-01-01T00:00:01.000Z',
    lastPublishedFingerprint: '',
  };
  const restoreFetch = setGlobal('fetch', () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ draft: { version: 1, graphs: { client: null, server: null } } }),
        { status: 200 },
      ),
    ));
  const restoreStorage = setGlobal('localStorage', {
    getItem() {
      return JSON.stringify(localDraft);
    },
    setItem() {},
  });

  try {
    mod.default.mount(document);
    fixture.loadButton.click();

    await waitFor(() => fixture.statusSummary.textContent === 'Loaded saved DAG');

    assertEquals(
      [...document.querySelectorAll('[data-node-id]')].some((node) =>
        node.getAttribute('data-node-policy') === 'accept'
      ),
      true,
    );
  } finally {
    restoreStorage();
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk publishes rendered graph from modal confirm', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({
      url,
      init,
      body: JSON.parse(init.body ?? '{}'),
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({ status: 'saved', pipelines: fetchCalls.at(-1).body.pipelines }),
        { status: 200 },
      ),
    );
  });

  try {
    mod.default.mount(document);
    fixture.publishButton.click();
    await waitFor(() => document.querySelector('[data-modal-action="confirm-publish"]') !== null);
    document.querySelector('[data-modal-action="confirm-publish"]').click();

    await waitFor(() =>
      fetchCalls.some((call) => call.url === '/admin/api/pipelines') &&
      document.querySelector('.modal-backdrop') === null &&
      fixture.statusSummary.textContent === 'Pipeline published'
    );

    const publishCall = fetchCalls.find((call) => call.url === '/admin/api/pipelines');
    assertEquals(publishCall.url, '/admin/api/pipelines');
    assertEquals(publishCall.body.pipelines.client, [
      { policy: 'write-guard', config: { require_auth: true } },
    ]);
    assertEquals(document.querySelector('.modal-backdrop'), null);
    assertEquals(fixture.statusSummary.textContent, 'Pipeline published');
  } finally {
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk preserves both directions when publishing loaded draft', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const draft = {
    version: 1,
    graphs: {
      client: {
        direction: 'client',
        nodes: [
          { id: 'client-start', type: 'start', policy: 'start' },
          { id: 'client-node-1', type: 'policy', policy: 'write-guard', config: { require_auth: true } },
        ],
        edges: [
          {
            id: 'client-edge-1',
            from: 'client-start',
            fromPort: 'next',
            to: 'client-node-1',
            toPort: 'in',
          },
        ],
      },
      server: {
        direction: 'server',
        nodes: [
          { id: 'server-start', type: 'start', policy: 'start' },
          { id: 'server-node-1', type: 'policy', policy: 'rate-limit' },
        ],
        edges: [
          {
            id: 'server-edge-1',
            from: 'server-start',
            fromPort: 'next',
            to: 'server-node-1',
            toPort: 'in',
          },
        ],
      },
    },
    viewports: {},
    updatedAt: '1970-01-01T00:00:01.000Z',
    lastPublishedFingerprint: '',
  };
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({
      url,
      init,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (url === '/admin/api/pipelines') {
      return Promise.resolve(
        new Response(
          JSON.stringify({ status: 'saved', pipelines: fetchCalls.at(-1).body.pipelines }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ draft }), { status: 200 }),
    );
  });
  const restoreStorage = setGlobal('localStorage', {
    getItem() {
      return null;
    },
    setItem() {},
  });

  try {
    mod.default.mount(document);
    fixture.loadButton.click();
    await waitFor(() => fixture.statusSummary.textContent === 'Loaded saved DAG');

    fixture.publishButton.click();
    await waitFor(() => document.querySelector('[data-modal-action="confirm-publish"]') !== null);
    document.querySelector('[data-modal-action="confirm-publish"]').click();

    await waitFor(() => fetchCalls.some((call) => call.url === '/admin/api/pipelines'));

    const publishCall = fetchCalls.find((call) => call.url === '/admin/api/pipelines');
    assertEquals(publishCall.body.pipelines.client, [
      { policy: 'write-guard', config: { require_auth: true } },
    ]);
    assertEquals(publishCall.body.pipelines.server, [{ policy: 'rate-limit' }]);
  } finally {
    restoreStorage();
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk evaluates playground messages through API', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({
      url,
      init,
      body: JSON.parse(init.body ?? '{}'),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ finalAction: 'accept' }), { status: 200 }),
    );
  });

  try {
    mod.default.mount(document);
    fixture.startNode.dispatchEvent({ type: 'dblclick' });
    document.querySelector('#playground-message-input').value = '["EVENT",{"id":"1"}]';
    document.querySelector('[data-modal-action="run-playground"]').click();

    await waitFor(() =>
      fetchCalls.some((call) => call.url === '/admin/api/playground/evaluate') &&
      /finalAction/.test(
        document.querySelector('.playground-result-panel')?.textContent ?? '',
      )
    );

    const evaluateCall = fetchCalls.find((call) => call.url === '/admin/api/playground/evaluate');
    assertEquals(evaluateCall.url, '/admin/api/playground/evaluate');
    assertEquals(evaluateCall.body.message, ['EVENT', { id: '1' }]);
    assertEquals(evaluateCall.body.direction, 'client');
    assertEquals(evaluateCall.body.pipeline, [
      { policy: 'write-guard', config: { require_auth: true } },
    ]);
    assertMatch(
      document.querySelector('.playground-result-panel')?.textContent ?? '',
      /finalAction/,
    );
  } finally {
    restoreFetch();
  }
});

Deno.test('PipelineWorkbench static chunk rejects non-array playground messages before fetch', async () => {
  const mod = await import(
    `./islands/PipelineWorkbench.js?test=${crypto.randomUUID()}`
  );
  const fixture = pipelineWorkbenchFixture();
  const document = new FakeDocument({
    childNodes: [fixture.workbench],
  });
  const fetchCalls = [];
  const restoreFetch = setGlobal('fetch', (url, init = {}) => {
    fetchCalls.push({ url, init });
    return Promise.resolve(new Response('{}', { status: 200 }));
  });

  try {
    mod.default.mount(document);
    fixture.startNode.dispatchEvent({ type: 'dblclick' });
    document.querySelector('#playground-message-input').value = '{"kind":1}';
    document.querySelector('[data-modal-action="run-playground"]').click();

    assertEquals(fetchCalls.some((call) => call.url === '/admin/api/playground/evaluate'), false);
    await waitFor(() => /JSON array/.test(document.querySelector('.playground-result-panel')?.textContent ?? ''));
    assertMatch(
      document.querySelector('.playground-result-panel')?.textContent ?? '',
      /JSON array/,
    );
  } finally {
    restoreFetch();
  }
});

Deno.test('fresh nav does not keep legacy pipelines page initializer', async () => {
  const source = await Deno.readTextFile(new URL('./fresh_nav.js', import.meta.url));

  assertEquals(source.includes('/admin/static/pipelines.js'), false);
  assertEquals(source.includes('initPipelinesPage'), false);
});
