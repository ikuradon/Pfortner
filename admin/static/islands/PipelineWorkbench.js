export default function PipelineWorkbench() {
  return null;
}

PipelineWorkbench.mount = function mountPipelineWorkbench(root) {
  const workbench = root.querySelector?.('#pipeline-workbench');
  if (!workbench || workbench.dataset.mounted === 'true') return;
  workbench.dataset.mounted = 'true';

  const clientButton = workbench.querySelector?.('#tab-client');
  const serverButton = workbench.querySelector?.('#tab-server');
  const canvasTitle = workbench.querySelector?.('#canvas-title');
  const paletteToggle = workbench.querySelector?.('#btn-toggle-palette');

  function setClass(element, className) {
    element?.setAttribute?.('class', className);
  }

  function setDirection(direction) {
    const isClient = direction === 'client';
    clientButton?.setAttribute?.('aria-pressed', String(isClient));
    serverButton?.setAttribute?.('aria-pressed', String(!isClient));
    setClass(
      clientButton,
      isClient ? 'btn btn-primary pipeline-mode-tab' : 'btn btn-ghost pipeline-mode-tab',
    );
    setClass(
      serverButton,
      isClient ? 'btn btn-ghost pipeline-mode-tab' : 'btn btn-primary pipeline-mode-tab',
    );
    if (canvasTitle) {
      canvasTitle.textContent = isClient ? 'Client Pipeline' : 'Server Pipeline';
    }
  }

  function toggleClass(element, className, enabled) {
    if (!element?.getAttribute || !element?.setAttribute) return;
    const classes = new Set(
      (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
    );
    if (enabled) {
      classes.add(className);
    } else {
      classes.delete(className);
    }
    element.setAttribute('class', [...classes].join(' '));
  }

  function setPaletteCollapsed(collapsed) {
    toggleClass(workbench, 'palette-collapsed', collapsed);
    if (paletteToggle) {
      paletteToggle.setAttribute?.(
        'aria-label',
        collapsed ? 'Expand palette' : 'Collapse palette',
      );
      paletteToggle.setAttribute?.(
        'title',
        collapsed ? 'Expand palette' : 'Collapse palette',
      );
      paletteToggle.textContent = collapsed ? '›' : '‹';
    }
  }

  clientButton?.addEventListener?.('click', () => setDirection('client'));
  serverButton?.addEventListener?.('click', () => setDirection('server'));
  paletteToggle?.addEventListener?.('click', () => {
    const collapsed = !(workbench.getAttribute?.('class') ?? '')
      .split(/\s+/)
      .includes('palette-collapsed');
    setPaletteCollapsed(collapsed);
  });
};
