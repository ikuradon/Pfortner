/** @jsxImportSource preact */

export function Toolbar(props: {
  onLoad(): void;
  onSave(): void;
  onPublish(): void;
  onUndo(): void;
  onRedo(): void;
  onFit(): void;
  onZoomOut(): void;
  onZoomIn(): void;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  return (
    <div class='pipeline-toolbar'>
      <button
        type='button'
        id='btn-undo-pipeline'
        class='btn btn-ghost'
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        ↶ Undo
      </button>
      <button
        type='button'
        id='btn-redo-pipeline'
        class='btn btn-ghost'
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        ↷ Redo
      </button>
      <button
        type='button'
        id='btn-fit-canvas'
        class='btn btn-ghost'
        onClick={props.onFit}
      >
        Fit
      </button>
      <button
        type='button'
        id='btn-zoom-out'
        class='btn btn-ghost'
        aria-label='Zoom out'
        onClick={props.onZoomOut}
      >
        -
      </button>
      <button
        type='button'
        id='btn-zoom-in'
        class='btn btn-ghost'
        aria-label='Zoom in'
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button
        type='button'
        id='btn-load-dag'
        class='btn btn-ghost'
        onClick={props.onLoad}
      >
        Load
      </button>
      <button
        type='button'
        id='btn-save-dag'
        class='btn btn-ghost'
        onClick={props.onSave}
      >
        Save
      </button>
      <button
        type='button'
        id='btn-publish-pipeline'
        class='btn btn-primary'
        onClick={props.onPublish}
      >
        Publish
      </button>
    </div>
  );
}
