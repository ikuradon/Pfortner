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
