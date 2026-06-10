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

  function yamlValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function buildYamlPreview() {
    const entries = [...(workbench.querySelectorAll?.('[data-node-id]') ?? [])]
      .filter((node) => !isStartNode(node))
      .map((node) => ({ policy: nodePolicy(node), config: configForNode(node) }));
    let yaml = 'pipelines:\n  client:\n';
    if (entries.length === 0) {
      yaml += '    []\n';
    } else {
      for (const entry of entries) {
        yaml += `    - policy: ${entry.policy}\n`;
        const keys = Object.keys(entry.config);
        if (keys.length > 0) {
          yaml += '      config:\n';
          for (const key of keys) {
            yaml += `        ${key}: ${yamlValue(entry.config[key])}\n`;
          }
        }
      }
    }
    yaml += '  server:\n    []\n';
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
      result.textContent = 'Local preview only. Playground API wiring is pending.';
    }));
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
      text: 'Local preview only',
    }));
    footer.appendChild?.(button('Close', 'btn btn-ghost', closeModal));
  }

  function openPublishModal() {
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
    const actions = createElement('div', { className: 'modal-footer-actions' });
    actions.appendChild?.(button('Cancel', 'btn btn-ghost', closeModal));
    actions.appendChild?.(button('Publish', 'btn btn-primary', closeModal));
    footer.appendChild?.(createElement('span', {
      className: 'text-muted',
      text: 'No changes are written in this step',
    }));
    footer.appendChild?.(actions);
  }

  function setDirection(direction) {
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

  clientButton?.addEventListener?.('click', () => setDirection('client'));
  serverButton?.addEventListener?.('click', () => setDirection('server'));
  publishButton?.addEventListener?.('click', openPublishModal);
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
};
