// Logs page — config/runtime 情報と SSE log stream を表示する。
// formatUptime と safeFetch は utils.js から global に提供される。

const MAX_VISIBLE_LOGS = 500;

let logStream = null;
let paused = false;
const seenLogIds = new Set();

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

function getLogRows() {
  return Array.from(document.querySelectorAll('#log-viewer .log-row'));
}

function updateLogCount() {
  const rows = getLogRows();
  const countEl = document.getElementById('log-count-display');
  if (countEl) countEl.textContent = rows.length + (rows.length === 1 ? ' line' : ' lines');

  const emptyEl = document.getElementById('log-empty-state');
  if (emptyEl) emptyEl.style.display = rows.length === 0 ? 'block' : 'none';
}

function setStreamStatus(state, label) {
  const statusEl = document.getElementById('log-stream-status');
  if (!statusEl) return;
  const effectiveState = paused && state === 'streaming' ? 'paused' : state;
  const effectiveLabel = paused && state === 'streaming' ? 'paused' : label;
  statusEl.textContent = effectiveLabel;
  statusEl.className = 'log-status log-status-' + effectiveState;
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function normalizeLevel(level) {
  const normalized = String(level || 'log').toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'log';
}

function parseLogLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const level = normalizeLevel(parsed.level);
      const timestamp = typeof parsed.timestamp === 'string'
        ? parsed.timestamp
        : typeof parsed.time === 'string'
        ? parsed.time
        : '';
      const message = typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.msg === 'string'
        ? parsed.msg
        : line;
      const details = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (key !== 'timestamp' && key !== 'time' && key !== 'level' && key !== 'message' && key !== 'msg') {
          details[key] = value;
        }
      }
      const detailKeys = Object.keys(details);
      return {
        level,
        timestamp,
        message,
        details: detailKeys.length > 0 ? JSON.stringify(details) : '',
      };
    }
  } catch {
    // text log として扱う。
  }

  const match = line.match(/^(\S+)\s+(DEBUG|INFO|WARN|ERROR)\s+(.*)$/);
  if (match) {
    return {
      level: normalizeLevel(match[2]),
      timestamp: match[1],
      message: match[3],
      details: '',
    };
  }

  return { level: 'log', timestamp: '', message: line, details: '' };
}

function pruneLogRows() {
  const rows = getLogRows();
  while (rows.length > MAX_VISIBLE_LOGS) {
    const row = rows.shift();
    if (!row) break;
    const id = Number(row.dataset.logId);
    if (Number.isFinite(id)) seenLogIds.delete(id);
    row.remove();
  }
}

function appendLogEntry(entry, options = {}) {
  if (!entry || typeof entry.line !== 'string') return;
  if (paused && !options.force) return;

  const id = Number(entry.id);
  if (Number.isFinite(id)) {
    if (seenLogIds.has(id)) return;
    seenLogIds.add(id);
  }

  const viewer = document.getElementById('log-viewer');
  if (!viewer) return;

  const wasAtBottom = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 24;
  const parsed = parseLogLine(entry.line);
  const level = normalizeLevel(parsed.level);

  const row = document.createElement('div');
  row.className = 'log-row log-row-' + level;
  row.title = entry.line;
  if (Number.isFinite(id)) row.dataset.logId = String(id);

  const time = document.createElement('span');
  time.className = 'log-row-time';
  time.textContent = formatTimestamp(parsed.timestamp || entry.received_at);
  row.appendChild(time);

  const levelEl = document.createElement('span');
  levelEl.className = 'log-row-level';
  levelEl.textContent = level.toUpperCase();
  row.appendChild(levelEl);

  const message = document.createElement('span');
  message.className = 'log-row-message';
  message.textContent = parsed.details ? parsed.message + ' ' + parsed.details : parsed.message;
  row.appendChild(message);

  viewer.appendChild(row);
  pruneLogRows();
  updateLogCount();

  if (wasAtBottom || options.force) {
    viewer.scrollTop = viewer.scrollHeight;
  }
}

function clearRenderedLogs() {
  for (const row of getLogRows()) {
    row.remove();
  }
  seenLogIds.clear();
  updateLogCount();
}

async function fetchInfo() {
  const [configData, healthData] = await Promise.all([
    safeFetch('/admin/api/config'),
    safeFetch('/admin/api/health/detail'),
  ]);

  const logLevel = configData?.infra?.metrics?.logging?.level ||
    configData?.log?.level ||
    configData?.logging?.level ||
    configData?.log_level ||
    '—';

  const logLevelEl = document.getElementById('log-level-display');
  if (logLevelEl) logLevelEl.textContent = String(logLevel);

  const uptime = healthData?.uptime_seconds != null ? formatUptime(healthData.uptime_seconds) : '—';
  const connections = healthData?.connections?.active != null ? String(healthData.connections.active) : '—';
  const status = healthData?.status || '—';
  const streamStatus = document.getElementById('log-stream-status')?.textContent || '—';

  const tbody = document.getElementById('runtime-info-tbody');
  if (!tbody) return;

  clearChildren(tbody);

  tbody.appendChild(makeInfoRow('Log Level', String(logLevel)));
  tbody.appendChild(makeInfoRow('Server Status', status));
  tbody.appendChild(makeInfoRow('Uptime', uptime));
  tbody.appendChild(makeInfoRow('Active Connections', connections));
  tbody.appendChild(makeInfoRow('Log Streaming', streamStatus));
  tbody.appendChild(makeInfoRow('Timestamp', new Date().toLocaleString()));
}

async function fetchLogs() {
  const data = await safeFetch('/admin/api/logs?limit=200');
  if (!data || !Array.isArray(data.logs)) {
    if (!logStream) setStreamStatus('fallback', 'fallback unavailable');
    return;
  }

  clearRenderedLogs();
  for (const entry of data.logs) {
    appendLogEntry(entry, { force: true });
  }

  if (!logStream) {
    setStreamStatus('fallback', 'fallback');
  }
}

function connectStream() {
  if (logStream) {
    logStream.close();
  }
  logStream = createEventStream({
    url: '/admin/api/logs/stream?replay=100',
    eventName: 'log',
    onStatus: (state, label) => {
      setStreamStatus(state, label);
      if (state === 'streaming') fetchInfo();
    },
    onEvent: (event) => {
      try {
        appendLogEntry(JSON.parse(event.data));
        if (!paused) setStreamStatus('streaming', 'streaming');
      } catch {
        setStreamStatus('disconnected', 'invalid stream event');
      }
    },
    fallback: () => {
      fetchLogs();
      fetchInfo();
    },
  });
  logStream.connect();
}

function togglePause() {
  paused = !paused;

  const btnPause = document.getElementById('btn-pause-logs');
  if (btnPause) btnPause.textContent = paused ? 'Resume' : 'Pause';

  if (paused) {
    setStreamStatus('paused', 'paused');
  } else {
    setStreamStatus(logStream ? 'streaming' : 'connecting', logStream ? 'streaming' : 'connecting');
    fetchLogs();
  }

  fetchInfo();
}

export function initLogsPage() {
  if (logStream) {
    logStream.close();
    logStream = null;
  }
  paused = false;
  seenLogIds.clear();

  updateLogCount();
  fetchInfo();
  fetchLogs();
  connectStream();

  const btnRefresh = document.getElementById('btn-refresh-logs');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchInfo();
      fetchLogs();
      if (!logStream || logStream.isClosed()) {
        connectStream();
      }
    });
  }

  const btnPause = document.getElementById('btn-pause-logs');
  if (btnPause) btnPause.addEventListener('click', togglePause);

  const btnClear = document.getElementById('btn-clear-logs');
  if (btnClear) btnClear.addEventListener('click', clearRenderedLogs);
  return () => {
    logStream?.close();
    logStream = null;
  };
}

if (typeof document !== 'undefined' && !globalThis.__PFORTNER_SPA__) {
  document.addEventListener('DOMContentLoaded', initLogsPage);
}
