/** @jsxImportSource preact */

export function PublishModal(props: {
  yaml: string;
  validationError?: string;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <div class='modal-backdrop'>
      <section
        class='workbench-modal publish-panel'
        role='dialog'
        aria-modal='true'
        aria-labelledby='publish-modal-title'
      >
        <header class='workbench-modal-header'>
          <div>
            <h2 id='publish-modal-title'>Publish</h2>
            <span class='text-muted'>YAML preview</span>
          </div>
          <button
            type='button'
            class='btn btn-ghost btn-icon'
            aria-label='Close publish preview'
            onClick={props.onClose}
          >
            X
          </button>
        </header>
        <div class='workbench-modal-body'>
          <pre class='yaml-preview'>{props.yaml}</pre>
          {props.validationError
            ? (
              <div class='modal-error' role='alert'>
                {props.validationError}
              </div>
            )
            : null}
        </div>
        <footer class='workbench-modal-footer'>
          <span class='text-muted'>Writes active config</span>
          <div class='modal-footer-actions'>
            <button type='button' class='btn btn-ghost' onClick={props.onClose}>
              Cancel
            </button>
            <button
              type='button'
              class='btn btn-primary'
              data-modal-action='confirm-publish'
              disabled={Boolean(props.validationError)}
              onClick={props.onConfirm}
            >
              Publish
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
