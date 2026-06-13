export default function AdminIslandSmoke() {
  return null;
}

AdminIslandSmoke.mount = function mountAdminIslandSmoke(root) {
  const button = root.querySelector('[data-admin-island-smoke="true"]');
  if (!button || button.dataset.mounted === 'true') return;
  button.dataset.mounted = 'true';
  button.addEventListener('click', () => {
    const current = Number(button.dataset.count || '0') + 1;
    button.dataset.count = String(current);
    button.textContent = `Island smoke ${current}`;
  });
};
