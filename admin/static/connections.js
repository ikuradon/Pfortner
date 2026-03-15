// Connections page — fetch, filter, bulk disconnect
// Note: innerHTML is intentionally avoided; all user-sourced data is passed through
// escapeHtml() before being inserted, and table structure is built via DOM methods.
const POLL_INTERVAL = 10000;

let allConnections = [];
let authFilter = 'all';
let searchText = '';

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

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

  const elTotal = document.getElementById('summary-total');
  const elAuthed = document.getElementById('summary-authed');
  const elUnauthed = document.getElementById('summary-unauthed');
  if (elTotal) elTotal.textContent = String(total);
  if (elAuthed) elAuthed.textContent = String(authed);
  if (elUnauthed) elUnauthed.textContent = String(unauthed);
}

function filterConnections(connections) {
  return connections.filter((c) => {
    const isAuthed = !!(c.authenticated || c.pubkey);
    if (authFilter === 'authenticated' && !isAuthed) return false;
    if (authFilter === 'unauthenticated' && isAuthed) return false;

    if (searchText) {
      const q = searchText.toLowerCase();
      const ip = (c.ip || c.remoteAddr || '').toLowerCase();
      const pk = (c.pubkey || '').toLowerCase();
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
  const id = c.id || c.connectionId || '';
  const ip = c.ip || c.remoteAddr || '—';
  const pubkey = c.pubkey || '';
  const isAuthed = !!(c.authenticated || pubkey);
  const connectedAt = c.connectedAt || c.connected_at || '';

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

  // Clear existing rows
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (connections.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.textAlign = 'center';
    td.style.padding = '32px';
    td.style.color = 'var(--color-text-muted)';
    td.textContent = 'No connections';
    tr.appendChild(td);
    tbody.appendChild(tr);
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
    allConnections = Array.isArray(data.connections) ? data.connections : [];
    updateSummary(allConnections);
    applyFiltersAndRender();
  } catch (e) {
    const tbody = document.getElementById('connections-tbody');
    if (!tbody) return;
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.textAlign = 'center';
    td.style.padding = '32px';
    td.style.color = 'var(--color-danger)';
    td.textContent = 'Error loading connections: ' + e.message;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Initial fetch
  fetchConnections();

  // Auto-refresh
  setInterval(fetchConnections, POLL_INTERVAL);

  // Refresh button
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', fetchConnections);

  // Bulk disconnect button
  const btnBulk = document.getElementById('btn-disconnect-selected');
  if (btnBulk) {
    btnBulk.addEventListener('click', () => {
      disconnectBatch(getCheckedIds());
    });
  }

  // Select all checkbox
  const selectAll = document.getElementById('select-all');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      document.querySelectorAll('.row-check').forEach((chk) => {
        chk.checked = e.target.checked;
      });
      updateBulkButton();
    });
  }

  // Search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchText = e.target.value.trim();
      applyFiltersAndRender();
    });
  }

  // Auth filter buttons
  document.querySelectorAll('.auth-filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      authFilter = e.currentTarget.dataset.filter || 'all';
      // Update button styles
      document.querySelectorAll('.auth-filter-btn').forEach((b) => {
        b.className = b.dataset.filter === authFilter
          ? 'btn btn-primary auth-filter-btn'
          : 'btn btn-ghost auth-filter-btn';
      });
      applyFiltersAndRender();
    });
  });
});
