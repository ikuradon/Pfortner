/** @jsxImportSource preact */

export function Palette(props: {
  plugins: string[];
  collapsed: boolean;
  onToggle(): void;
  onAdd(policy: string): void;
}) {
  return (
    <aside
      class={props.collapsed ? 'workbench-panel palette-panel palette-collapsed' : 'workbench-panel palette-panel'}
      id='palette-panel'
    >
      <div class='workbench-panel-header palette-header'>
        <span>Policy Palette</span>
        <button
          type='button'
          class='btn btn-ghost btn-icon'
          id='btn-toggle-palette'
          title={props.collapsed ? 'Expand palette' : 'Collapse palette'}
          aria-label={props.collapsed ? 'Expand palette' : 'Collapse palette'}
          onClick={props.onToggle}
        >
          {props.collapsed ? '›' : '‹'}
        </button>
      </div>
      <div
        class='workbench-panel-body policy-palette'
        id='policy-palette'
      >
        {props.plugins.map((name) => (
          <button
            key={name}
            type='button'
            class='policy-palette-item'
            data-policy={name}
            draggable
            onDragStart={(event) => {
              event.dataTransfer?.setData(
                'application/x-pfortner-policy',
                name,
              );
              event.dataTransfer?.setData('text/plain', name);
            }}
            onClick={() => props.onAdd(name)}
            aria-label={`Add ${name}`}
          >
            <span class='policy-palette-icon'>
              {name.charAt(0).toUpperCase()}
            </span>
            <span class='policy-palette-name'>{name}</span>
            <span class='policy-palette-add'>+</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
