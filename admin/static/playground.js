// Playground — test messages against the pipeline

let currentDirection = 'client';

// ─── Presets ──────────────────────────────────────────────────────────────────

const PRESETS = {
  'event-1': JSON.stringify(
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
  'event-4': JSON.stringify(
    ['EVENT', {
      id: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      pubkey: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      created_at: Math.floor(Date.now() / 1000),
      kind: 4,
      tags: [['p', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff']],
      content: 'encrypted DM content',
      sig:
        'gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg',
    }],
    null,
    2,
  ),
  'event-1059': JSON.stringify(
    ['EVENT', {
      id: 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
      pubkey: 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii',
      created_at: Math.floor(Date.now() / 1000),
      kind: 1059,
      tags: [['p', 'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj']],
      content: 'gift wrap',
      sig:
        'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
    }],
    null,
    2,
  ),
  'req-basic': JSON.stringify(
    ['REQ', 'sub1', { kinds: [1], limit: 10 }],
    null,
    2,
  ),
  'req-search': JSON.stringify(
    ['REQ', 'sub2', { kinds: [1], search: 'hello', limit: 10 }],
    null,
    2,
  ),
  'close': JSON.stringify(
    ['CLOSE', 'sub1'],
    null,
    2,
  ),
};

// ─── Result rendering ─────────────────────────────────────────────────────────

function circleChar(action) {
  if (action === 'accept') return '✓';
  if (action === 'reject') return '✕';
  return '→';
}

function makeStepItem(step, isLast) {
  const item = document.createElement('div');
  item.className = 'step-item';

  // Left: circle + connector line
  const lineDiv = document.createElement('div');
  lineDiv.className = 'step-line';

  const circle = document.createElement('div');
  circle.className = 'step-circle ' + step.action;
  circle.textContent = circleChar(step.action);
  lineDiv.appendChild(circle);

  if (!isLast) {
    const connector = document.createElement('div');
    connector.className = 'step-connector';
    lineDiv.appendChild(connector);
  }

  item.appendChild(lineDiv);

  // Right: content
  const content = document.createElement('div');
  content.className = 'step-content';

  // Policy name + action badge
  const nameRow = document.createElement('div');
  const nameEl = document.createElement('span');
  nameEl.className = 'step-policy-name';
  nameEl.textContent = step.policy;
  nameRow.appendChild(nameEl);

  const badge = document.createElement('span');
  badge.className = 'step-action-badge ' + step.action;
  badge.textContent = step.action.toUpperCase();
  nameRow.appendChild(badge);

  if (step.branch) {
    const branchSpan = document.createElement('span');
    branchSpan.className = 'step-action-badge next';
    branchSpan.style.marginLeft = '4px';
    branchSpan.textContent = step.branch;
    nameRow.appendChild(branchSpan);
  }

  content.appendChild(nameRow);

  // Detail
  if (step.detail) {
    const detail = document.createElement('div');
    detail.className = 'step-detail';
    detail.textContent = step.detail;
    content.appendChild(detail);
  }

  // Response (for reject)
  if (step.response) {
    const resp = document.createElement('div');
    resp.className = 'step-response';
    resp.textContent = 'Response: ' + step.response;
    content.appendChild(resp);
  }

  item.appendChild(content);
  return item;
}

function renderResults(data) {
  const panel = document.getElementById('result-panel');
  if (!panel) return;

  // Clear
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  if (!data || !Array.isArray(data.steps)) {
    const err = document.createElement('div');
    err.className = 'playground-error';
    err.textContent = 'Invalid response from server';
    panel.appendChild(err);
    return;
  }

  if (data.steps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playground-empty';
    empty.textContent = 'Pipeline is empty — message would pass through.';
    panel.appendChild(empty);
  } else {
    const stepList = document.createElement('div');
    stepList.className = 'step-list';
    data.steps.forEach((step, i) => {
      stepList.appendChild(makeStepItem(step, i === data.steps.length - 1));
    });
    panel.appendChild(stepList);
  }

  // Final result
  const finalDiv = document.createElement('div');
  finalDiv.className = 'final-result ' + (data.finalAction === 'accept' ? 'accept' : 'reject');
  finalDiv.textContent = 'Final: ' + data.finalAction.toUpperCase();
  if (data.finalResponse) {
    const sub = document.createElement('div');
    sub.style.fontSize = '13px';
    sub.style.fontWeight = '400';
    sub.style.marginTop = '4px';
    sub.textContent = data.finalResponse;
    finalDiv.appendChild(sub);
  }
  panel.appendChild(finalDiv);
}

function renderError(msg) {
  const panel = document.getElementById('result-panel');
  if (!panel) return;
  while (panel.firstChild) panel.removeChild(panel.firstChild);
  const err = document.createElement('div');
  err.className = 'playground-error';
  err.textContent = msg;
  panel.appendChild(err);
}

// ─── Run evaluation ───────────────────────────────────────────────────────────

async function runEvaluation() {
  const btn = document.getElementById('btn-run');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running…';
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

  const authenticated = document.getElementById('ctx-authenticated')?.checked ?? false;
  const pubkey = document.getElementById('ctx-pubkey')?.value?.trim() ?? '';
  const clientIp = document.getElementById('ctx-ip')?.value?.trim() || '127.0.0.1';

  try {
    const res = await fetch('/admin/api/playground/evaluate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        direction: currentDirection,
        connectionInfo: { authenticated, pubkey, clientIp },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      renderError('Server error: ' + (err.error || res.status));
      return;
    }

    const data = await res.json();
    renderResults(data);
  } catch (e) {
    renderError('Request failed: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▷ Run';
    }
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Direction tabs
  document.querySelectorAll('.dir-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const dir = e.currentTarget.dataset.direction;
      if (!dir) return;
      currentDirection = dir;
      document.querySelectorAll('.dir-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.direction === dir);
      });
    });
  });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const preset = e.currentTarget.dataset.preset;
      if (!preset || !PRESETS[preset]) return;
      const textarea = document.getElementById('message-input');
      if (textarea) textarea.value = PRESETS[preset];
    });
  });

  // Run button
  const btnRun = document.getElementById('btn-run');
  if (btnRun) btnRun.addEventListener('click', runEvaluation);

  // Ctrl+Enter to run
  const textarea = document.getElementById('message-input');
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') runEvaluation();
    });
  }
});
