// Blacklist page — add/delete IP and pubkey entries via DOM methods (no innerHTML)

function makeDeleteButton(value, type) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-danger';
  btn.style.padding = '4px 10px';
  btn.style.fontSize = '12px';
  btn.textContent = 'Remove';
  btn.addEventListener('click', () => deleteEntry(type, value));
  return btn;
}

function renderList(tbodyId, entries, type) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  // Clear existing rows
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (!entries || entries.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.style.textAlign = 'center';
    td.style.padding = '24px';
    td.style.color = 'var(--color-text-muted)';
    td.textContent = 'No entries';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const entry of entries) {
    const tr = document.createElement('tr');

    const tdValue = document.createElement('td');
    tdValue.style.fontFamily = 'monospace';
    tdValue.style.fontSize = '13px';
    tdValue.textContent = entry;
    tr.appendChild(tdValue);

    const tdAction = document.createElement('td');
    tdAction.appendChild(makeDeleteButton(entry, type));
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  }
}

function showError(containerId, message) {
  const container = document.getElementById(containerId);
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  const p = document.createElement('p');
  p.style.color = 'var(--color-danger)';
  p.style.padding = '12px 0';
  p.textContent = 'Error: ' + message;
  container.appendChild(p);
}

async function fetchBlacklist() {
  try {
    const res = await fetch('/admin/api/blacklist', {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderList('ip-tbody', data.ips || [], 'ip');
    renderList('pubkey-tbody', data.pubkeys || [], 'pubkey');
  } catch (e) {
    showError('ip-list-container', e.message);
    showError('pubkey-list-container', e.message);
  }
}

async function addEntry(type, value) {
  if (!value) return;
  const body = type === 'ip' ? { ip: value } : { pubkey: value };
  try {
    const res = await fetch('/admin/api/blacklist/' + type, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Request failed');
    }
    await fetchBlacklist();
  } catch (e) {
    alert('Error adding entry: ' + e.message);
  }
}

async function deleteEntry(type, value) {
  if (!confirm('Remove ' + value + ' from blacklist?')) return;
  try {
    const res = await fetch(
      '/admin/api/blacklist/' + type + '/' + encodeURIComponent(value),
      {
        method: 'DELETE',
        credentials: 'same-origin',
      },
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await fetchBlacklist();
  } catch (e) {
    alert('Error removing entry: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  fetchBlacklist();

  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', fetchBlacklist);

  const btnAddIp = document.getElementById('btn-add-ip');
  if (btnAddIp) {
    btnAddIp.addEventListener('click', () => {
      const input = document.getElementById('ip-input');
      const value = input ? input.value.trim() : '';
      if (!value) {
        alert('Please enter an IP address.');
        return;
      }
      addEntry('ip', value).then(() => {
        if (input) input.value = '';
      });
    });
  }

  const btnAddPubkey = document.getElementById('btn-add-pubkey');
  if (btnAddPubkey) {
    btnAddPubkey.addEventListener('click', () => {
      const input = document.getElementById('pubkey-input');
      const value = input ? input.value.trim() : '';
      if (!value) {
        alert('Please enter a pubkey.');
        return;
      }
      addEntry('pubkey', value).then(() => {
        if (input) input.value = '';
      });
    });
  }

  // Allow Enter key in inputs
  const ipInput = document.getElementById('ip-input');
  if (ipInput) {
    ipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-add-ip')?.click();
    });
  }

  const pubkeyInput = document.getElementById('pubkey-input');
  if (pubkeyInput) {
    pubkeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-add-pubkey')?.click();
    });
  }
});
