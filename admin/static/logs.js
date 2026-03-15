// Logs page — display log level from config and runtime info

function makeInfoRow(label, value) {
  const tr = document.createElement('tr');

  const tdLabel = document.createElement('td');
  tdLabel.style.fontWeight = '600';
  tdLabel.style.color = 'var(--color-text-muted)';
  tdLabel.style.width = '200px';
  tdLabel.textContent = label;
  tr.appendChild(tdLabel);

  const tdValue = document.createElement('td');
  tdValue.style.fontFamily = 'monospace';
  tdValue.textContent = value;
  tr.appendChild(tdValue);

  return tr;
}

async function fetchInfo() {
  // Fetch config for log level
  let logLevel = '—';
  try {
    const res = await fetch('/admin/api/config', {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const data = await res.json();
      logLevel = data?.log?.level || data?.logging?.level || data?.log_level ||
        '—';
    }
  } catch {
    // ignore
  }

  const logLevelEl = document.getElementById('log-level-display');
  if (logLevelEl) logLevelEl.textContent = String(logLevel);

  // Fetch health detail for runtime info
  let uptime = '—';
  let connections = '—';
  let status = '—';
  try {
    const res = await fetch('/admin/api/health/detail', {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const data = await res.json();
      uptime = data.uptime_seconds != null ? formatUptime(data.uptime_seconds) : '—';
      connections = data.connections?.active != null ? String(data.connections.active) : '—';
      status = data.status || '—';
    }
  } catch {
    // ignore
  }

  const tbody = document.getElementById('runtime-info-tbody');
  if (!tbody) return;

  // Clear existing rows
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  tbody.appendChild(makeInfoRow('Log Level', String(logLevel)));
  tbody.appendChild(makeInfoRow('Server Status', status));
  tbody.appendChild(makeInfoRow('Uptime', uptime));
  tbody.appendChild(makeInfoRow('Active Connections', connections));
  tbody.appendChild(makeInfoRow('Log Streaming', 'Not yet available'));
  tbody.appendChild(makeInfoRow('Timestamp', new Date().toLocaleString()));
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

document.addEventListener('DOMContentLoaded', () => {
  fetchInfo();

  const btnRefresh = document.getElementById('btn-refresh-logs');
  if (btnRefresh) btnRefresh.addEventListener('click', fetchInfo);
});
