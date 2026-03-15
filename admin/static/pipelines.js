// Pipeline Editor — visual tree + YAML preview

let currentDirection = 'client';
const pipelines = { client: [], server: [] };
let availablePlugins = [];
const expandedEntries = new Set();

// ─── YAML serializer ──────────────────────────────────────────────────────────

function toYamlValue(val, indent) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    // Quote if contains special chars
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
      if (typeof val[k] === 'object' && val[k] !== null && !Array.isArray(val[k])) {
        return indent + k + ':\n' +
          Object.keys(val[k]).map((sk) => indent + '  ' + sk + ': ' + toYamlValue(val[k][sk], indent + '    ')).join(
            '\n',
          );
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

function buildYamlPreview(pipes) {
  let yaml = 'pipelines:\n';
  yaml += '  client:\n' + entriesToYaml(pipes.client, '  ');
  yaml += '  server:\n' + entriesToYaml(pipes.server, '  ');
  return yaml;
}

// ─── Policy icons ─────────────────────────────────────────────────────────────

function policyIcon(name) {
  const icons = {
    'accept': '✓',
    'kind-filter': '⊞',
    'write-guard': '✎',
    'protected-event': '🔒',
    'rate-limit': '⏱',
    'spam-filter': '🚫',
    'content-filter': '⊟',
    'pubkey-acl': '👤',
    'ip-filter': '🌐',
    'when': '?',
    'match': '≡',
    'route': '→',
  };
  return icons[name] ?? '⚙';
}

function condensedConfig(entry) {
  if (!entry.config || Object.keys(entry.config).length === 0) return '';
  const parts = [];
  const cfg = entry.config;
  if (cfg.allow_kinds) parts.push('allow:' + cfg.allow_kinds.join(','));
  if (cfg.deny_kinds) parts.push('deny:' + cfg.deny_kinds.join(','));
  if (cfg.require_auth !== undefined) parts.push('require_auth:' + cfg.require_auth);
  if (cfg.condition) parts.push('if:' + JSON.stringify(cfg.condition).slice(0, 40));
  if (cfg.allow) parts.push('allow:[' + (cfg.allow.length) + ']');
  if (cfg.deny) parts.push('deny:[' + (cfg.deny.length) + ']');
  if (parts.length === 0) {
    const keys = Object.keys(cfg);
    parts.push(keys.slice(0, 2).join(', '));
  }
  return parts.join(' · ');
}

// ─── Tree rendering ───────────────────────────────────────────────────────────

function renderEntry(entry, index, path, parentEntries) {
  const pathKey = path.join('-');
  const isExpanded = expandedEntries.has(pathKey);

  const div = document.createElement('div');
  div.className = 'pipeline-entry';
  div.dataset.path = pathKey;

  // Move buttons
  const moveDiv = document.createElement('div');
  moveDiv.className = 'move-btns';

  const btnUp = document.createElement('button');
  btnUp.type = 'button';
  btnUp.className = 'move-btn';
  btnUp.textContent = '▲';
  btnUp.title = 'Move up';
  btnUp.disabled = index === 0;
  btnUp.addEventListener('click', (e) => {
    e.stopPropagation();
    moveEntry(parentEntries, index, -1);
    render();
  });

  const btnDown = document.createElement('button');
  btnDown.type = 'button';
  btnDown.className = 'move-btn';
  btnDown.textContent = '▼';
  btnDown.title = 'Move down';
  btnDown.disabled = index === parentEntries.length - 1;
  btnDown.addEventListener('click', (e) => {
    e.stopPropagation();
    moveEntry(parentEntries, index, 1);
    render();
  });

  moveDiv.appendChild(btnUp);
  moveDiv.appendChild(btnDown);
  div.appendChild(moveDiv);

  // Icon
  const iconDiv = document.createElement('div');
  iconDiv.className = 'pipeline-entry-icon';
  iconDiv.textContent = policyIcon(entry.policy);
  div.appendChild(iconDiv);

  // Info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'pipeline-entry-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'pipeline-entry-name';
  nameEl.textContent = entry.policy;
  infoDiv.appendChild(nameEl);

  const configEl = document.createElement('div');
  configEl.className = 'pipeline-entry-config';
  configEl.textContent = condensedConfig(entry);
  infoDiv.appendChild(configEl);

  div.appendChild(infoDiv);

  // Actions
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'pipeline-entry-actions';

  const btnEdit = document.createElement('button');
  btnEdit.type = 'button';
  btnEdit.className = 'pipeline-entry-btn';
  btnEdit.textContent = isExpanded ? '▲ Close' : '✎ Edit';
  btnEdit.addEventListener('click', (e) => {
    e.stopPropagation();
    if (expandedEntries.has(pathKey)) {
      expandedEntries.delete(pathKey);
    } else {
      expandedEntries.add(pathKey);
    }
    render();
  });

  const btnDelete = document.createElement('button');
  btnDelete.type = 'button';
  btnDelete.className = 'pipeline-entry-btn delete';
  btnDelete.textContent = '✕ Delete';
  btnDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('Delete policy "' + entry.policy + '"?')) {
      parentEntries.splice(index, 1);
      expandedEntries.delete(pathKey);
      render();
    }
  });

  actionsDiv.appendChild(btnEdit);
  actionsDiv.appendChild(btnDelete);
  div.appendChild(actionsDiv);

  // Config editor (expanded)
  if (isExpanded) {
    const editorDiv = document.createElement('div');
    editorDiv.className = 'config-editor-panel';
    editorDiv.style.width = '100%';
    editorDiv.style.marginTop = '8px';

    const label = document.createElement('label');
    label.className = 'config-editor-label';
    label.textContent = 'Config (YAML/JSON):';
    editorDiv.appendChild(label);

    const textarea = document.createElement('textarea');
    textarea.className = 'config-editor-textarea';
    textarea.value = entry.config ? JSON.stringify(entry.config, null, 2) : '';
    textarea.placeholder = '{}';
    textarea.addEventListener('change', () => {
      try {
        const parsed = textarea.value.trim() ? JSON.parse(textarea.value) : {};
        entry.config = parsed;
        render();
      } catch (e) {
        setStatus('Config parse error: ' + e.message, true);
      }
    });
    editorDiv.appendChild(textarea);

    // Make the editor full-width by wrapping
    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';
    wrapper.style.gridColumn = '1 / -1';
    wrapper.appendChild(editorDiv);
    div.appendChild(wrapper);
    div.style.flexWrap = 'wrap';
  }

  // Children for when/match
  const result = document.createElement('div');
  result.appendChild(div);

  if (entry.policy === 'when' && entry.config) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'pipeline-children';

    if (Array.isArray(entry.config.then)) {
      const thenLabel = document.createElement('div');
      thenLabel.className = 'pipeline-children-label';
      thenLabel.textContent = 'then';
      childrenDiv.appendChild(thenLabel);
      renderEntries(entry.config.then, [...path, 'then'], childrenDiv);
    }

    if (Array.isArray(entry.config.else) && entry.config.else.length > 0) {
      const elseLabel = document.createElement('div');
      elseLabel.className = 'pipeline-children-label';
      elseLabel.textContent = 'else';
      childrenDiv.appendChild(elseLabel);
      renderEntries(entry.config.else, [...path, 'else'], childrenDiv);
    }

    result.appendChild(childrenDiv);
  }

  if (entry.policy === 'match' && entry.config) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'pipeline-children';

    if (Array.isArray(entry.config.cases)) {
      entry.config.cases.forEach((c, ci) => {
        const caseLabel = document.createElement('div');
        caseLabel.className = 'pipeline-children-label';
        caseLabel.textContent = 'case ' + (ci + 1) + ': ' + JSON.stringify(c.condition ?? {}).slice(0, 40);
        childrenDiv.appendChild(caseLabel);
        if (Array.isArray(c.pipeline)) {
          renderEntries(c.pipeline, [...path, 'cases', String(ci), 'pipeline'], childrenDiv);
        }
      });
    }

    if (Array.isArray(entry.config.default) && entry.config.default.length > 0) {
      const defaultLabel = document.createElement('div');
      defaultLabel.className = 'pipeline-children-label';
      defaultLabel.textContent = 'default';
      childrenDiv.appendChild(defaultLabel);
      renderEntries(entry.config.default, [...path, 'default'], childrenDiv);
    }

    result.appendChild(childrenDiv);
  }

  return result;
}

function renderEntries(entries, path, container) {
  if (!entries || entries.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '12px';
    empty.style.color = 'var(--color-text-muted)';
    empty.style.padding = '8px 0';
    empty.textContent = '(empty)';
    container.appendChild(empty);
    return;
  }
  entries.forEach((entry, i) => {
    container.appendChild(renderEntry(entry, i, [...path, String(i)], entries));
  });
}

function moveEntry(arr, index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= arr.length) return;
  const tmp = arr[index];
  arr[index] = arr[newIndex];
  arr[newIndex] = tmp;
}

// ─── Status ───────────────────────────────────────────────────────────────────

function setStatus(msg, isError) {
  const el = document.getElementById('pipeline-status');
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!msg) return;
  const span = document.createElement('span');
  span.className = 'badge ' + (isError ? 'badge-danger' : 'badge-success');
  span.style.fontSize = '13px';
  span.style.padding = '4px 12px';
  span.textContent = msg;
  el.appendChild(span);
  setTimeout(() => {
    if (el.contains(span)) el.removeChild(span);
  }, 5000);
}

// ─── Main render ──────────────────────────────────────────────────────────────

function render() {
  const container = document.getElementById('pipeline-tree-container');
  if (!container) return;

  // Clear
  while (container.firstChild) container.removeChild(container.firstChild);

  const entries = pipelines[currentDirection] ?? [];
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pipeline-empty';
    empty.textContent = 'No policies in this pipeline. Add one below.';
    container.appendChild(empty);
  } else {
    renderEntries(entries, [currentDirection], container);
  }

  // Update YAML preview
  const yamlEl = document.getElementById('yaml-preview');
  if (yamlEl) yamlEl.textContent = buildYamlPreview(pipelines);

  // Update panel title
  const titleEl = document.getElementById('tree-panel-title');
  if (titleEl) {
    titleEl.textContent = (currentDirection === 'client' ? 'Client' : 'Server') + ' Pipeline — Visual Tree';
  }
}

// ─── API calls ────────────────────────────────────────────────────────────────

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

function populatePluginSelect(plugins) {
  const sel = document.getElementById('add-policy-select');
  if (!sel) return;
  // Remove old options except first
  while (sel.options.length > 1) sel.remove(1);
  for (const name of plugins) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
}

async function applyConfig() {
  const btn = document.getElementById('btn-apply-pipeline');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Applying…';
  }
  try {
    // POST the reload endpoint — re-reads config from disk
    const res = await fetch('/admin/api/reload', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (res.ok || res.type === 'opaqueredirect' || res.status === 0 || res.status === 302) {
      setStatus('Config reloaded at ' + new Date().toLocaleTimeString(), false);
    } else {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Apply failed');
    }
  } catch (e) {
    setStatus('Error: ' + e.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✓ Apply Config';
    }
  }
}

// ─── Defaults for new policies ────────────────────────────────────────────────

function defaultConfigForPolicy(name) {
  switch (name) {
    case 'accept':
      return {};
    case 'kind-filter':
      return { allow_kinds: [1, 3, 6, 7] };
    case 'write-guard':
      return { require_auth: true };
    case 'protected-event':
      return {};
    case 'rate-limit':
      return { max_per_minute: 60 };
    case 'spam-filter':
      return {};
    case 'content-filter':
      return { max_length: 1000 };
    case 'pubkey-acl':
      return { allow: [], deny: [] };
    case 'ip-filter':
      return { allow: [], deny: [] };
    case 'when':
      return { condition: { authenticated: true }, then: [{ policy: 'accept' }], else: [] };
    case 'match':
      return { cases: [], default: [] };
    case 'route':
      return { upstream: '' };
    default:
      return {};
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const [configData, pluginsData] = await Promise.all([fetchConfig(), fetchPlugins()]);

    // Parse pipelines from config
    pipelines.client = configData.pipelines?.client ?? [];
    pipelines.server = configData.pipelines?.server ?? [];

    availablePlugins = pluginsData.plugins ?? [];
    populatePluginSelect(availablePlugins);
    render();
  } catch (e) {
    const container = document.getElementById('pipeline-tree-container');
    if (container) {
      while (container.firstChild) container.removeChild(container.firstChild);
      const err = document.createElement('div');
      err.className = 'pipeline-empty';
      err.style.color = 'var(--color-danger)';
      err.textContent = 'Error loading config: ' + e.message;
      container.appendChild(err);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  // Tab buttons
  document.querySelectorAll('.pipeline-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const dir = e.currentTarget.dataset.pipeline;
      if (!dir) return;
      currentDirection = dir;
      document.querySelectorAll('.pipeline-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.pipeline === dir);
      });
      render();
    });
  });

  // Refresh
  const btnRefresh = document.getElementById('btn-refresh-pipelines');
  if (btnRefresh) btnRefresh.addEventListener('click', init);

  // Apply
  const btnApply = document.getElementById('btn-apply-pipeline');
  if (btnApply) btnApply.addEventListener('click', applyConfig);

  // Add policy
  const btnAdd = document.getElementById('btn-add-policy');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      const sel = document.getElementById('add-policy-select');
      const policyName = sel?.value;
      if (!policyName) {
        setStatus('Select a policy to add', true);
        return;
      }
      const newEntry = {
        policy: policyName,
        config: defaultConfigForPolicy(policyName),
      };
      if (!pipelines[currentDirection]) pipelines[currentDirection] = [];
      pipelines[currentDirection].push(newEntry);
      if (sel) sel.value = '';
      render();
      setStatus('Added ' + policyName, false);
    });
  }
});
