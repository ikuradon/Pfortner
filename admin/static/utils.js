// Shared utility functions for Admin UI pages

/**
 * Format uptime seconds into a human-readable string.
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  if (seconds === null || seconds === undefined) return 'unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

/**
 * Format an ISO timestamp into a relative age string.
 * @param {string|null|undefined} isoString
 * @returns {string}
 */
function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

/**
 * Fetch a URL with same-origin credentials, check res.ok, and return parsed JSON.
 * Returns null on any error.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<unknown|null>}
 */
async function safeFetch(url, options) {
  try {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Remove all children from a node.
 * @param {Node|null|undefined} node
 */
function clearChildren(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Set textContent on an element by id if it exists.
 * @param {string} id
 * @param {unknown} value
 */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

/**
 * Build a table cell with optional class/style.
 * @param {unknown} text
 * @param {{className?: string, style?: string, title?: string}} [options]
 * @returns {HTMLTableCellElement}
 */
function makeCell(text, options) {
  const td = document.createElement('td');
  if (options?.className) td.className = options.className;
  if (options?.style) td.style.cssText = options.style;
  if (options?.title) td.title = options.title;
  td.textContent = text == null || text === '' ? '—' : String(text);
  return td;
}

/**
 * Render a single table state row.
 * @param {HTMLTableSectionElement|null|undefined} tbody
 * @param {number} colSpan
 * @param {string} message
 * @param {'empty'|'error'|'loading'} [kind]
 */
function renderTableState(tbody, colSpan, message, kind) {
  if (!tbody) return;
  clearChildren(tbody);
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colSpan;
  td.style.textAlign = 'center';
  td.style.padding = '32px';
  td.style.color = kind === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)';
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

/**
 * Normalize legacy/internal connection shapes into the admin UI DTO.
 * @param {Record<string, unknown>} raw
 * @returns {{id:string, ip:string, authenticated:boolean, pubkey:string, connectedAt:string|null}}
 */
function normalizeConnection(raw) {
  const id = raw?.id ?? raw?.connectionId ?? '';
  const ip = raw?.ip ?? raw?.remoteAddr ?? raw?.connectionIpAddr ?? '';
  const pubkey = raw?.pubkey ?? raw?.clientPubkey ?? '';
  const authenticated = Boolean(raw?.authenticated ?? raw?.clientAuthorized ?? pubkey);
  const connectedAt = raw?.connectedAt ?? raw?.connected_at ?? null;
  return {
    id: String(id),
    ip: String(ip),
    authenticated,
    pubkey: String(pubkey),
    connectedAt: connectedAt == null ? null : String(connectedAt),
  };
}

/**
 * Create a visibility-aware poller.
 * @param {{intervalMs:number, run:()=>Promise<void>|void, runImmediately?:boolean}} options
 * @returns {{start:()=>void, stop:()=>void, refresh:()=>Promise<void>}}
 */
function createPoller(options) {
  let timer = null;
  let running = false;

  async function refresh() {
    if (running) return;
    running = true;
    try {
      await options.run();
    } finally {
      running = false;
    }
  }

  function start() {
    stop();
    if (options.runImmediately !== false) refresh();
    timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh();
    }, options.intervalMs);
  }

  function stop() {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }

  window.addEventListener('pagehide', stop);
  return { start, stop, refresh };
}

/**
 * Create an EventSource wrapper with status and fallback callbacks.
 * @param {{url:string, onEvent:(event:MessageEvent)=>void, eventName?:string, onHeartbeat?:(event:MessageEvent)=>void, onStatus?:(status:string,label:string)=>void, fallback?:()=>Promise<void>|void}} options
 * @returns {{connect:()=>void, close:()=>void, isClosed:()=>boolean}}
 */
function createEventStream(options) {
  let source = null;
  const eventName = options.eventName ?? 'message';

  function setStatus(status, label) {
    options.onStatus?.(status, label);
  }

  function close() {
    if (source) {
      source.close();
      source = null;
    }
  }

  function connect() {
    if (!('EventSource' in window)) {
      setStatus('fallback', 'fallback');
      options.fallback?.();
      return;
    }

    close();
    setStatus('connecting', 'connecting');
    source = new EventSource(options.url);
    source.onopen = () => setStatus('streaming', 'streaming');
    source.addEventListener(eventName, options.onEvent);
    source.addEventListener('heartbeat', (event) => {
      options.onHeartbeat?.(event);
      setStatus('streaming', 'streaming');
    });
    source.onerror = () => {
      setStatus('disconnected', 'disconnected');
      options.fallback?.();
    };
  }

  window.addEventListener('pagehide', close);

  return {
    connect,
    close,
    isClosed: () => !source || !('EventSource' in window) || source.readyState === EventSource.CLOSED,
  };
}
