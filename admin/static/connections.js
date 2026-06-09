// Connections page — fetch, filter, bulk disconnect
// Note: innerHTML is intentionally avoided; all user-sourced data is passed through
// escapeHtml() before being inserted, and table structure is built via DOM methods.
const POLL_INTERVAL = 10000;

let allConnections = [];
let authFilter = 'all';
let searchText = '';
let poller = null;

function shortId(id) {
  if (!id) return '—';
  return id.slice(0, 8);
}

function shortPubkey(pubkey) {
  if (!pubkey) return '—';
  return pubkey.slice(0, 8) + '\u2026';
}

function updateSummary(connections) {
  const total = connections.length;
  const authed = connections.filter((c) => c.authenticated || c.pubkey).length;
  const unauthed = total - authed;

  setText('summary-total', total);
  setText('summary-authed', authed);
  setText('summary-unauthed', unauthed);
}

function filterConnections(connections) {
  return connections.filter((c) => {
    const isAuthed = !!(c.authenticated || c.pubkey);
    if (authFilter === 'authenticated' && !isAuthed) return false;
    if (authFilter === 'unauthenticated' && isAuthed) return false;

    if (searchText) {
      const q = searchText.toLowerCase();
      const ip = c.ip.toLowerCase();
      const pk = c.pubkey.toLowerCase();
      if (!ip.includes(q) && !pk.includes(q)) return false;
    }
    return true;
  });
}

function makeBadge(isAuthed) {
  const span = document.createElement('span');
  span.className = isAuthed ? 'badge badge-success' : 'badge badge-danger';
  span.textContent = isAuthed ? 'Auth' : 'No Auth';
  return span;
}

function makeDisconnectButton(id) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-danger btn-disconnect';
  btn.dataset.id = id;
  btn.style.padding = '4px 10px';
  btn.style.fontSize = '12px';
  btn.textContent = 'Disconnect';
  btn.addEventListener('click', () => disconnectBatch([id]));
  return btn;
}

function makeRow(c) {
  const id = c.id;
  const ip = c.ip || '—';
  const pubkey = c.pubkey;
  const isAuthed = !!(c.authenticated || pubkey);
  const connectedAt = c.connectedAt;

  const tr = document.createElement('tr');
  tr.dataset.id = id;

  // Checkbox cell
  const tdCheck = document.createElement('td');
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.className = 'row-check';
  chk.dataset.id = id;
  chk.addEventListener('change', updateBulkButton);
  tdCheck.appendChild(chk);
  tr.appendChild(tdCheck);

  // ID cell
  const tdId = document.createElement('td');
  const idSpan = document.createElement('span');
  idSpan.title = id;
  idSpan.style.fontFamily = 'monospace';
  idSpan.style.fontSize = '12px';
  idSpan.textContent = shortId(id);
  tdId.appendChild(idSpan);
  tr.appendChild(tdId);

  // IP cell
  const tdIp = document.createElement('td');
  tdIp.style.fontFamily = 'monospace';
  tdIp.style.fontSize = '12px';
  tdIp.textContent = ip;
  tr.appendChild(tdIp);

  // Pubkey cell
  const tdPk = document.createElement('td');
  tdPk.style.fontFamily = 'monospace';
  tdPk.style.fontSize = '12px';
  if (pubkey) {
    const pkSpan = document.createElement('span');
    pkSpan.title = pubkey;
    pkSpan.textContent = shortPubkey(pubkey);
    tdPk.appendChild(pkSpan);
  } else {
    tdPk.textContent = '—';
  }
  tr.appendChild(tdPk);

  // Auth badge cell
  const tdAuth = document.createElement('td');
  tdAuth.appendChild(makeBadge(isAuthed));
  tr.appendChild(tdAuth);

  // Connected time cell
  const tdTime = document.createElement('td');
  tdTime.style.fontSize = '12px';
  tdTime.style.color = 'var(--color-text-muted)';
  tdTime.textContent = formatRelativeTime(connectedAt);
  tr.appendChild(tdTime);

  // Action cell
  const tdAction = document.createElement('td');
  tdAction.appendChild(makeDisconnectButton(id));
  tr.appendChild(tdAction);

  return tr;
}

function renderTable(connections) {
  const tbody = document.getElementById('connections-tbody');
  if (!tbody) return;

  clearChildren(tbody);

  if (connections.length === 0) {
    renderTableState(tbody, 7, 'No connections', 'empty');
    return;
  }

  for (const c of connections) {
    tbody.appendChild(makeRow(c));
  }
}

function getCheckedIds() {
  return [...document.querySelectorAll('.row-check:checked')].map((el) => el.dataset.id);
}

function updateBulkButton() {
  const btn = document.getElementById('btn-disconnect-selected');
  if (!btn) return;
  const ids = getCheckedIds();
  btn.disabled = ids.length === 0;
}

async function disconnectBatch(ids) {
  if (!ids || ids.length === 0) return;
  if (!confirm('Disconnect ' + ids.length + ' connection(s)?')) return;
  try {
    const res = await fetch('/admin/api/connections/disconnect-batch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    await fetchConnections();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function applyFiltersAndRender() {
  const filtered = filterConnections(allConnections);
  renderTable(filtered);
  updateBulkButton();
}

async function fetchConnections() {
  try {
    const res = await fetch('/admin/api/connections', {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allConnections = Array.isArray(data.connections) ? data.connections.map(normalizeConnection) : [];
    updateSummary(allConnections);
    applyFiltersAndRender();
  } catch (e) {
    const tbody = document.getElementById('connections-tbody');
    renderTableState(tbody, 7, 'Error loading connections: ' + e.message, 'error');
  }
}

export function initConnectionsPage() {
  if (poller) poller.stop();
  allConnections = [];
  authFilter = 'all';
  searchText = '';
  poller = createPoller({ intervalMs: POLL_INTERVAL, run: fetchConnections });
  poller.start();
  const activePoller = poller;

  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', () => activePoller.refresh());

  const btnBulk = document.getElementById('btn-disconnect-selected');
  if (btnBulk) {
    btnBulk.addEventListener('click', () => {
      disconnectBatch(getCheckedIds());
    });
  }

  const selectAll = document.getElementById('select-all');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      document.querySelectorAll('.row-check').forEach((chk) => {
        chk.checked = e.target.checked;
      });
      updateBulkButton();
    });
  }

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchText = e.target.value.trim();
      applyFiltersAndRender();
    });
  }

  document.querySelectorAll('.auth-filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      authFilter = e.currentTarget.dataset.filter || 'all';
      document.querySelectorAll('.auth-filter-btn').forEach((b) => {
        b.className = b.dataset.filter === authFilter
          ? 'btn btn-primary auth-filter-btn'
          : 'btn btn-ghost auth-filter-btn';
      });
      applyFiltersAndRender();
    });
  });
  return () => activePoller.stop();
}

if (typeof document !== 'undefined' && !globalThis.__PFORTNER_SPA__) {
  document.addEventListener('DOMContentLoaded', initConnectionsPage);
}
