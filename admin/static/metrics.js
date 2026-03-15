// Metrics dashboard — throughput chart, policy decisions, raw metrics viewer
const POLL_INTERVAL = 10000;
const MAX_TRACKER_MINUTES = 5; // ThroughputTracker only keeps ~5 minutes of data

let selectedRange = 5; // minutes
let rawMetricsText = '';
let rawMetricsExpanded = false;

// ─── SVG Chart Utilities ──────────────────────────────────────────────────────

function buildSvgChart(data, options) {
  const {
    height = 100,
    barW = 8,
    barGap = 2,
    valueKeys,
    colors,
    labels,
  } = options;

  if (!data || data.length === 0) {
    const noData = document.createElement('span');
    noData.className = 'text-muted';
    noData.textContent = 'No data available';
    return noData;
  }

  const maxVal = Math.max(
    ...data.map((d) => valueKeys.reduce((sum, k) => sum + (d[k] || 0), 0)),
    1,
  );

  const barGroupW = barW * valueKeys.length + barGap * (valueKeys.length - 1);
  const groupGap = 3;
  const totalW = data.length * (barGroupW + groupGap);

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(totalW));
  svg.setAttribute('height', String(height));
  svg.setAttribute('style', 'display:block;overflow:visible');

  // X-axis time labels (show up to 10 labels)
  const labelStep = Math.max(1, Math.floor(data.length / 10));
  for (let i = 0; i < data.length; i += labelStep) {
    const d = data[i];
    if (!d.ts) continue;
    const x = i * (barGroupW + groupGap) + barGroupW / 2;
    const text = document.createElementNS(svgNs, 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(height + 14));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', 'var(--color-text-muted)');
    const date = new Date(d.ts);
    text.textContent = date.getHours().toString().padStart(2, '0') + ':' +
      date.getMinutes().toString().padStart(2, '0');
    svg.appendChild(text);
  }

  // Bars
  data.forEach((d, i) => {
    const groupX = i * (barGroupW + groupGap);
    valueKeys.forEach((key, ki) => {
      const val = d[key] || 0;
      const barH = Math.round((val / maxVal) * height);
      if (barH === 0) return;
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', String(groupX + ki * (barW + barGap)));
      rect.setAttribute('y', String(height - barH));
      rect.setAttribute('width', String(barW));
      rect.setAttribute('height', String(barH));
      rect.setAttribute('fill', colors[ki]);
      rect.setAttribute('opacity', '0.85');
      rect.setAttribute('rx', '2');

      // Tooltip on hover
      const titleEl = document.createElementNS(svgNs, 'title');
      titleEl.textContent = (labels[ki] || key) + ': ' + val;
      rect.appendChild(titleEl);
      svg.appendChild(rect);
    });
  });

  const wrapper = document.createElement('div');

  const scrollDiv = document.createElement('div');
  scrollDiv.style.cssText = 'overflow-x:auto;padding-bottom:20px';

  scrollDiv.appendChild(svg);
  wrapper.appendChild(scrollDiv);

  // Legend
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:16px;margin-top:4px;font-size:11px;color:var(--color-text-muted)';
  valueKeys.forEach((key, ki) => {
    const item = document.createElement('span');
    item.style.cssText = 'display:flex;align-items:center;gap:4px';
    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:10px;height:10px;display:inline-block;border-radius:2px;background:' + colors[ki];
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(labels[ki] || key));
    legend.appendChild(item);
  });
  wrapper.appendChild(legend);

  return wrapper;
}

// ─── Throughput Chart ─────────────────────────────────────────────────────────

function renderThroughputChart(buckets) {
  const container = document.getElementById('throughput-chart-body');
  if (!container) return;

  // Filter by selected time range
  const cutoff = Date.now() - selectedRange * 60 * 1000;
  const filtered = buckets.filter((b) => b.ts >= cutoff);

  const insufficient = selectedRange > MAX_TRACKER_MINUTES && filtered.length === 0;

  if (insufficient || buckets.length === 0) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const msg = document.createElement('span');
    msg.className = 'text-muted';
    msg.textContent = selectedRange > MAX_TRACKER_MINUTES
      ? 'Insufficient data \u2014 only ~5 minutes of history is available'
      : 'No throughput data available';
    container.appendChild(msg);
    return;
  }

  const result = buildSvgChart(filtered.length > 0 ? filtered : buckets, {
    height: 100,
    barW: 8,
    barGap: 2,
    valueKeys: ['accept', 'reject'],
    colors: ['var(--color-accent)', 'var(--color-danger)'],
    labels: ['Accept', 'Reject'],
  });

  container.replaceChildren(result);
}

// ─── Connection Activity Chart ────────────────────────────────────────────────

function renderConnectionChart(buckets) {
  const container = document.getElementById('connection-chart-body');
  if (!container) return;

  const cutoff = Date.now() - selectedRange * 60 * 1000;
  const filtered = buckets.filter((b) => b.ts >= cutoff);
  const data = (filtered.length > 0 ? filtered : buckets).map((b) => ({
    ts: b.ts,
    total: (b.accept || 0) + (b.reject || 0),
  }));

  if (data.length === 0) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const msg = document.createElement('span');
    msg.className = 'text-muted';
    msg.textContent = 'No activity data available';
    container.appendChild(msg);
    return;
  }

  const result = buildSvgChart(data, {
    height: 80,
    barW: 10,
    barGap: 0,
    valueKeys: ['total'],
    colors: ['var(--color-success)'],
    labels: ['Messages'],
  });

  container.replaceChildren(result);
}

// ─── Policy Decisions Table ───────────────────────────────────────────────────

function parsePrometheusMetrics(text) {
  const decisions = {};
  const re = /^pfortner_policy_decisions_total\{([^}]+)\}\s+(\d+(?:\.\d+)?)$/;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = re.exec(trimmed);
    if (!m) continue;

    const labelStr = m[1];
    const value = parseInt(m[2], 10);

    const labelMap = {};
    for (const part of labelStr.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).replace(/^"|"$/g, '').trim();
      labelMap[k] = v;
    }

    const policy = labelMap['policy'] || '(unknown)';
    const action = labelMap['action'] || '(unknown)';

    if (!decisions[policy]) decisions[policy] = { accept: 0, reject: 0, next: 0, other: 0 };
    const key = action === 'accept' || action === 'reject' || action === 'next' ? action : 'other';
    decisions[policy][key] += value;
  }

  return decisions;
}

function renderPolicyTable(text) {
  const container = document.getElementById('policy-decisions-body');
  if (!container) return;

  const decisions = parsePrometheusMetrics(text);
  const policies = Object.entries(decisions);

  if (policies.length === 0) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const msg = document.createElement('div');
    msg.style.cssText = 'text-align:center;padding:24px;color:var(--color-text-muted)';
    msg.textContent = 'No policy decision data available';
    container.appendChild(msg);
    return;
  }

  // Sort by total decisions descending
  policies.sort((a, b) => {
    const totalA = a[1].accept + a[1].reject + a[1].next + a[1].other;
    const totalB = b[1].accept + b[1].reject + b[1].next + b[1].other;
    return totalB - totalA;
  });

  const table = document.createElement('table');
  table.className = 'table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const col of ['Policy', 'Accept', 'Reject', 'Next', 'Total']) {
    const th = document.createElement('th');
    th.textContent = col;
    if (col !== 'Policy') th.style.textAlign = 'right';
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const [policyName, counts] of policies) {
    const total = counts.accept + counts.reject + counts.next + counts.other;
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.style.cssText = 'font-family:monospace;font-size:12px';
    tdName.textContent = policyName;
    tr.appendChild(tdName);

    const tdAccept = document.createElement('td');
    tdAccept.style.cssText = 'text-align:right;color:var(--color-success)';
    tdAccept.textContent = String(counts.accept);
    tr.appendChild(tdAccept);

    const tdReject = document.createElement('td');
    tdReject.style.cssText = 'text-align:right;color:var(--color-danger)';
    tdReject.textContent = String(counts.reject);
    tr.appendChild(tdReject);

    const tdNext = document.createElement('td');
    tdNext.style.cssText = 'text-align:right;color:var(--color-text-muted)';
    tdNext.textContent = String(counts.next);
    tr.appendChild(tdNext);

    const tdTotal = document.createElement('td');
    tdTotal.style.cssText = 'text-align:right;font-weight:600';
    tdTotal.textContent = String(total);
    tr.appendChild(tdTotal);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(table);
}

// ─── Raw Metrics Viewer ───────────────────────────────────────────────────────

function applyRawMetricsFilter() {
  const searchInput = document.getElementById('raw-metrics-search');
  const pre = document.getElementById('raw-metrics-pre');
  if (!pre) return;

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  if (!query) {
    pre.textContent = rawMetricsText || '# No metrics data';
    return;
  }

  const filtered = rawMetricsText
    .split('\n')
    .filter((line) => line.toLowerCase().includes(query))
    .join('\n');
  pre.textContent = filtered || '# No matching lines';
}

function updateRawMetrics(text) {
  rawMetricsText = text;
  applyRawMetricsFilter();
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchThroughput() {
  try {
    const res = await fetch('/admin/api/metrics/throughput', {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const data = await res.json();
      const buckets = Array.isArray(data) ? data : [];
      renderThroughputChart(buckets);
      renderConnectionChart(buckets);
    }
  } catch {
    // ignore polling errors
  }
}

async function fetchPrometheusMetrics() {
  try {
    const res = await fetch('/admin/api/metrics/prometheus', {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const text = await res.text();
      updateRawMetrics(text);
      renderPolicyTable(text);
    }
  } catch {
    // ignore polling errors
  }
}

async function refreshAll() {
  await Promise.all([fetchThroughput(), fetchPrometheusMetrics()]);
}

// ─── Time Range Selector ──────────────────────────────────────────────────────

function setupTimeRangeButtons() {
  document.querySelectorAll('.time-range-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const range = parseInt(e.currentTarget.dataset.range || '5', 10);
      selectedRange = range;
      document.querySelectorAll('.time-range-btn').forEach((b) => {
        b.className = parseInt(b.dataset.range || '5', 10) === range
          ? 'btn btn-primary time-range-btn'
          : 'btn btn-ghost time-range-btn';
      });
      fetchThroughput();
    });
  });
}

// ─── Raw Metrics Expand/Collapse ──────────────────────────────────────────────

function setupRawMetricsToggle() {
  const toggle = document.getElementById('raw-metrics-toggle');
  const content = document.getElementById('raw-metrics-content');
  const chevron = document.getElementById('raw-metrics-chevron');

  if (!toggle || !content || !chevron) return;

  toggle.addEventListener('click', () => {
    rawMetricsExpanded = !rawMetricsExpanded;
    content.style.display = rawMetricsExpanded ? 'block' : 'none';
    chevron.textContent = rawMetricsExpanded ? '\u25bc Collapse' : '\u25b6 Expand';
  });

  // Search filter
  const searchInput = document.getElementById('raw-metrics-search');
  if (searchInput) {
    searchInput.addEventListener('input', applyRawMetricsFilter);
  }

  // Copy button
  const copyBtn = document.getElementById('btn-copy-metrics');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rawMetricsText);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      } catch {
        // Fallback: select the pre text
        const pre = document.getElementById('raw-metrics-pre');
        if (pre) {
          const range = document.createRange();
          range.selectNodeContents(pre);
          const sel = globalThis.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }
    });
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupTimeRangeButtons();
  setupRawMetricsToggle();

  // Initial data load
  refreshAll();

  // Auto-refresh every 10 seconds
  setInterval(refreshAll, POLL_INTERVAL);

  // Refresh button
  const btnRefresh = document.getElementById('btn-refresh-metrics');
  if (btnRefresh) btnRefresh.addEventListener('click', refreshAll);
});
