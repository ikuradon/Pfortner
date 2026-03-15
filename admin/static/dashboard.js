// Dashboard polling — stats cards and throughput chart
// formatUptime and safeFetch are provided globally by utils.js
const POLL_INTERVAL = 5000;

function formatMB(bytes) {
  return Math.round(bytes / 1024 / 1024) + ' MB';
}

function makeBadge(cssClass, text) {
  const span = document.createElement('span');
  span.className = cssClass;
  span.textContent = text;
  return span;
}

function makeCard(title, valueNode, subtitle) {
  const card = document.createElement('div');
  card.className = 'card';

  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const valueEl = document.createElement('div');
  valueEl.className = 'card-value';
  if (typeof valueNode === 'string') {
    valueEl.textContent = valueNode;
  } else {
    valueEl.appendChild(valueNode);
  }
  card.appendChild(valueEl);

  const subtitleEl = document.createElement('div');
  subtitleEl.className = 'card-subtitle';
  subtitleEl.textContent = subtitle;
  card.appendChild(subtitleEl);

  return card;
}

function updateStats(data) {
  const cards = document.getElementById('stats-cards');
  if (!cards) return;

  // Build status badge
  let statusBadge;
  if (data.status === 'ok') {
    statusBadge = makeBadge('badge badge-success', 'OK');
  } else if (data.status === 'draining') {
    statusBadge = makeBadge('badge badge-warning', 'Draining');
  } else {
    statusBadge = makeBadge('badge badge-danger', String(data.status));
  }

  // Build upstream badge
  let upstreamBadge;
  if (data.upstream && data.upstream.status === 'ok') {
    upstreamBadge = makeBadge('badge badge-success', 'Online');
  } else {
    upstreamBadge = makeBadge('badge badge-danger', String(data.upstream?.status ?? 'unknown'));
  }

  const active = data.connections?.active ?? 0;
  const max = data.connections?.max ?? 0;
  const pressure = data.connections?.pressure ?? 'normal';
  const latency = data.upstream?.latency_ms !== null && data.upstream?.latency_ms !== undefined
    ? data.upstream.latency_ms + 'ms'
    : 'N/A';

  const rss = data.memory?.rss ? formatMB(data.memory.rss) : 'N/A';
  const heap = data.memory?.heapUsed ? formatMB(data.memory.heapUsed) : 'N/A';

  // Clear and rebuild cards
  while (cards.firstChild) cards.removeChild(cards.firstChild);
  cards.appendChild(makeCard('Status', statusBadge, 'Uptime: ' + formatUptime(data.uptime_seconds)));
  cards.appendChild(makeCard('Connections', String(active), 'Max: ' + max));
  cards.appendChild(makeCard('Upstream', upstreamBadge, 'Latency: ' + latency));
  cards.appendChild(makeCard('Memory (RSS)', rss, 'Heap: ' + heap));

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

  while (container.firstChild) container.removeChild(container.firstChild);

  if (!data || data.length === 0) {
    const msg = document.createElement('span');
    msg.className = 'text-muted';
    msg.textContent = 'No throughput data available';
    container.appendChild(msg);
    return;
  }

  const maxVal = Math.max(...data.map((d) => Math.max(d.accept || 0, d.reject || 0)), 1);
  const barW = 8;
  const barGap = 2;
  const chartH = 80;
  const totalW = data.length * (barW * 2 + barGap + 2);

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(totalW));
  svg.setAttribute('height', String(chartH));
  svg.setAttribute('style', 'display:block;overflow:visible');

  data.forEach((d, i) => {
    const x = i * (barW * 2 + barGap + 2);
    const acceptH = Math.round(((d.accept || 0) / maxVal) * chartH);
    const rejectH = Math.round(((d.reject || 0) / maxVal) * chartH);

    if (acceptH > 0) {
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(chartH - acceptH));
      rect.setAttribute('width', String(barW));
      rect.setAttribute('height', String(acceptH));
      rect.setAttribute('fill', 'var(--color-accent)');
      rect.setAttribute('opacity', '0.8');
      svg.appendChild(rect);
    }

    if (rejectH > 0) {
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', String(x + barW + 1));
      rect.setAttribute('y', String(chartH - rejectH));
      rect.setAttribute('width', String(barW));
      rect.setAttribute('height', String(rejectH));
      rect.setAttribute('fill', 'var(--color-danger)');
      rect.setAttribute('opacity', '0.8');
      svg.appendChild(rect);
    }
  });

  const wrapper = document.createElement('div');

  const scrollDiv = document.createElement('div');
  scrollDiv.style.cssText = 'overflow-x:auto';
  scrollDiv.appendChild(svg);
  wrapper.appendChild(scrollDiv);

  // Legend
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--color-text-muted)';

  const acceptItem = document.createElement('span');
  acceptItem.style.cssText = 'display:flex;align-items:center;gap:4px';
  const acceptSwatch = document.createElement('span');
  acceptSwatch.style.cssText =
    'width:10px;height:10px;background:var(--color-accent);display:inline-block;border-radius:2px';
  acceptItem.appendChild(acceptSwatch);
  acceptItem.appendChild(document.createTextNode('Accept'));
  legend.appendChild(acceptItem);

  const rejectItem = document.createElement('span');
  rejectItem.style.cssText = 'display:flex;align-items:center;gap:4px';
  const rejectSwatch = document.createElement('span');
  rejectSwatch.style.cssText =
    'width:10px;height:10px;background:var(--color-danger);display:inline-block;border-radius:2px';
  rejectItem.appendChild(rejectSwatch);
  rejectItem.appendChild(document.createTextNode('Reject'));
  legend.appendChild(rejectItem);

  wrapper.appendChild(legend);
  container.appendChild(wrapper);
}

async function pollStats() {
  const data = await safeFetch('/admin/api/health/detail');
  if (data) updateStats(data);
}

async function pollThroughput() {
  const data = await safeFetch('/admin/api/metrics/throughput');
  if (data) renderThroughputChart(Array.isArray(data) ? data : []);
}

async function poll() {
  await Promise.all([pollStats(), pollThroughput()]);
}

document.addEventListener('DOMContentLoaded', () => {
  poll();
  setInterval(poll, POLL_INTERVAL);
});
