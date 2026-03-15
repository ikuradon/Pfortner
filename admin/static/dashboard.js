// Dashboard polling — stats cards and throughput chart
const POLL_INTERVAL = 5000;

function formatUptime(seconds) {
  if (seconds === null || seconds === undefined) return 'unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function formatMB(bytes) {
  return Math.round(bytes / 1024 / 1024) + ' MB';
}

function updateStats(data) {
  const cards = document.getElementById('stats-cards');
  if (!cards) return;

  const statusBadge = data.status === 'ok'
    ? '<span class="badge badge-success">OK</span>'
    : data.status === 'draining'
    ? '<span class="badge badge-warning">Draining</span>'
    : '<span class="badge badge-danger">' + data.status + '</span>';

  const upstreamBadge = data.upstream && data.upstream.status === 'ok'
    ? '<span class="badge badge-success">Online</span>'
    : '<span class="badge badge-danger">' + (data.upstream?.status ?? 'unknown') + '</span>';

  const active = data.connections?.active ?? 0;
  const max = data.connections?.max ?? 0;
  const pressure = data.connections?.pressure ?? 'normal';
  const latency = data.upstream?.latency_ms !== null && data.upstream?.latency_ms !== undefined
    ? data.upstream.latency_ms + 'ms'
    : 'N/A';

  const rss = data.memory?.rss ? formatMB(data.memory.rss) : 'N/A';
  const heap = data.memory?.heapUsed ? formatMB(data.memory.heapUsed) : 'N/A';

  cards.innerHTML = `
    <div class="card">
      <div class="card-title">Status</div>
      <div class="card-value">${statusBadge}</div>
      <div class="card-subtitle">Uptime: ${formatUptime(data.uptime_seconds)}</div>
    </div>
    <div class="card">
      <div class="card-title">Connections</div>
      <div class="card-value">${active}</div>
      <div class="card-subtitle">Max: ${max}</div>
    </div>
    <div class="card">
      <div class="card-title">Upstream</div>
      <div class="card-value">${upstreamBadge}</div>
      <div class="card-subtitle">Latency: ${latency}</div>
    </div>
    <div class="card">
      <div class="card-title">Memory (RSS)</div>
      <div class="card-value">${rss}</div>
      <div class="card-subtitle">Heap: ${heap}</div>
    </div>
  `;

  // Update pressure bar
  const pct = max > 0 ? Math.round((active / max) * 100) : 0;
  const pressureClass = pct >= 90 ? 'progress-bar-danger' : pct >= 70 ? 'progress-bar-warning' : 'progress-bar-success';
  const container = document.querySelector('.chart-container');
  if (container) {
    const titleEl = container.querySelector('.chart-title');
    if (titleEl) {
      titleEl.textContent = 'Connection Pressure — ' + pct + '% (' + active + '/' + max + ')';
    }
    const bar = container.querySelector('.progress-bar');
    if (bar) {
      bar.className = 'progress-bar ' + pressureClass;
      bar.style.width = pct + '%';
    }
    const pressureText = container.querySelector('strong');
    if (pressureText) {
      pressureText.textContent = pressure;
    }
  }
}

function renderThroughputChart(data) {
  const container = document.getElementById('throughput-chart-body');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<span class="text-muted">No throughput data available</span>';
    return;
  }

  const maxVal = Math.max(...data.map((d) => Math.max(d.accept || 0, d.reject || 0)), 1);
  const barW = 8;
  const barGap = 2;
  const chartH = 80;
  const totalW = data.length * (barW * 2 + barGap + 2);

  let bars = '';
  data.forEach((d, i) => {
    const x = i * (barW * 2 + barGap + 2);
    const acceptH = Math.round(((d.accept || 0) / maxVal) * chartH);
    const rejectH = Math.round(((d.reject || 0) / maxVal) * chartH);
    bars += `<rect x="${x}" y="${
      chartH - acceptH
    }" width="${barW}" height="${acceptH}" fill="var(--color-accent)" opacity="0.8"/>`;
    bars += `<rect x="${x + barW + 1}" y="${
      chartH - rejectH
    }" width="${barW}" height="${rejectH}" fill="var(--color-danger)" opacity="0.8"/>`;
  });

  container.innerHTML = `
    <div>
      <svg width="${totalW}" height="${chartH}" style="display:block;overflow:visible">
        ${bars}
      </svg>
      <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--color-text-muted)">
        <span style="display:flex;align-items:center;gap:4px">
          <span style="width:10px;height:10px;background:var(--color-accent);display:inline-block;border-radius:2px"></span>
          Accept
        </span>
        <span style="display:flex;align-items:center;gap:4px">
          <span style="width:10px;height:10px;background:var(--color-danger);display:inline-block;border-radius:2px"></span>
          Reject
        </span>
      </div>
    </div>
  `;
}

async function pollStats() {
  try {
    const res = await fetch('/admin/api/health/detail', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      updateStats(data);
    }
  } catch {
    // ignore polling errors
  }
}

async function pollThroughput() {
  try {
    const res = await fetch('/admin/api/metrics/throughput', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      renderThroughputChart(Array.isArray(data) ? data : []);
    }
  } catch {
    // ignore polling errors
  }
}

async function poll() {
  await Promise.all([pollStats(), pollThroughput()]);
}

document.addEventListener('DOMContentLoaded', () => {
  poll();
  setInterval(poll, POLL_INTERVAL);
});
