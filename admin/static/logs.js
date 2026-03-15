// Logs page — display log level from config and runtime info
// formatUptime and safeFetch are provided globally by utils.js

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
  // Fetch config and health-detail in parallel
  const [configData, healthData] = await Promise.all([
    safeFetch('/admin/api/config'),
    safeFetch('/admin/api/health/detail'),
  ]);

  const logLevel = configData?.log?.level || configData?.logging?.level || configData?.log_level || '—';

  const logLevelEl = document.getElementById('log-level-display');
  if (logLevelEl) logLevelEl.textContent = String(logLevel);

  const uptime = healthData?.uptime_seconds != null ? formatUptime(healthData.uptime_seconds) : '—';
  const connections = healthData?.connections?.active != null ? String(healthData.connections.active) : '—';
  const status = healthData?.status || '—';

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

document.addEventListener('DOMContentLoaded', () => {
  fetchInfo();

  const btnRefresh = document.getElementById('btn-refresh-logs');
  if (btnRefresh) btnRefresh.addEventListener('click', fetchInfo);
});
