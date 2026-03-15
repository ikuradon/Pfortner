// Theme toggle
function initThemeToggle() {
  const mount = document.getElementById('theme-toggle-mount');
  if (!mount) return;

  const btn = document.createElement('button');
  btn.className = 'theme-toggle';
  btn.title = 'Toggle dark/light theme';
  btn.setAttribute('aria-label', 'Toggle theme');

  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function updateBtn(theme) {
    btn.textContent = theme === 'dark' ? '☀' : '☽';
  }

  updateBtn(getCurrentTheme());

  btn.addEventListener('click', () => {
    const current = getCurrentTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('pfortner-theme', next);
    } catch { /* ignore */ }
    updateBtn(next);
  });

  mount.appendChild(btn);
}

document.addEventListener('DOMContentLoaded', initThemeToggle);
