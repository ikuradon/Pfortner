/** @jsxImportSource preact */

export function ViewportControls(props: {
  onFit(): void;
  onZoomOut(): void;
  onZoomIn(): void;
}) {
  return (
    <div class='canvas-viewport-controls' aria-label='Canvas controls'>
      <button
        type='button'
        id='btn-fit-canvas'
        class='btn btn-ghost canvas-control-btn'
        onClick={props.onFit}
      >
        Fit
      </button>
      <button
        type='button'
        id='btn-zoom-out'
        class='btn btn-ghost canvas-control-btn'
        aria-label='Zoom out'
        onClick={props.onZoomOut}
      >
        -
      </button>
      <button
        type='button'
        id='btn-zoom-in'
        class='btn btn-ghost canvas-control-btn'
        aria-label='Zoom in'
        onClick={props.onZoomIn}
      >
        +
      </button>
    </div>
  );
}
