// Config page — display current config and trigger reload

function showStatus(message, isError) {
  const el = document.getElementById('config-status');
  if (!el) return;

  // Clear existing content
  while (el.firstChild) el.removeChild(el.firstChild);

  const span = document.createElement('span');
  span.className = 'badge ' + (isError ? 'badge-danger' : 'badge-success');
  span.style.fontSize = '13px';
  span.style.padding = '4px 12px';
  span.textContent = message;
  el.appendChild(span);

  // Auto-clear after 5 seconds
  setTimeout(() => {
    if (el.contains(span)) el.removeChild(span);
  }, 5000);
}

async function fetchConfig() {
  const pre = document.getElementById('config-json');
  if (!pre) return;

  try {
    const res = await fetch('/admin/api/config', {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    pre.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    pre.textContent = 'Error loading config: ' + e.message;
    pre.style.color = 'var(--color-danger)';
  }
}

async function reloadConfig() {
  const btn = document.getElementById('btn-reload-config');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Reloading…';
  }
  try {
    const res = await fetch('/admin/api/reload', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    // A redirect (302) means success — the server reloaded OK
    if (
      res.ok || res.type === 'opaqueredirect' || res.status === 0 ||
      res.status === 302
    ) {
      showStatus(
        'Config reloaded successfully at ' + new Date().toLocaleTimeString(),
        false,
      );
      await fetchConfig();
    } else {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Reload failed');
    }
  } catch (e) {
    showStatus('Reload failed: ' + e.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '\u21bb Reload Config';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  fetchConfig();

  const btnRefresh = document.getElementById('btn-refresh-config');
  if (btnRefresh) btnRefresh.addEventListener('click', fetchConfig);

  const btnReload = document.getElementById('btn-reload-config');
  if (btnReload) btnReload.addEventListener('click', reloadConfig);
});
