/** @jsxImportSource preact */
import { useState } from 'preact/hooks';

export function PlaygroundModal(props: {
  nodeId: string | null;
  result?: string;
  onRun(message: string): void;
  onClose(): void;
}) {
  const [message, setMessage] = useState('');

  return (
    <div class='modal-backdrop'>
      <section
        class='workbench-modal fullscreen playground-panel'
        role='dialog'
        aria-modal='true'
        aria-labelledby='playground-modal-title'
      >
        <header class='workbench-modal-header'>
          <div>
            <h2 id='playground-modal-title'>Playground</h2>
            {props.nodeId ? <span class='text-muted'>{props.nodeId}</span> : null}
          </div>
          <button
            type='button'
            class='btn btn-ghost btn-icon'
            aria-label='Close playground'
            onClick={props.onClose}
          >
            X
          </button>
        </header>
        <div class='workbench-modal-body playground-modal-body'>
          <div class='playground-modal-grid'>
            <section aria-label='Message input'>
              <label class='form-label' for='playground-message-input'>
                Message
              </label>
              <textarea
                id='playground-message-input'
                class='message-textarea'
                value={message}
                onInput={(event) =>
                  setMessage(
                    (event.currentTarget as HTMLTextAreaElement).value,
                  )}
              />
              <button
                type='button'
                class='btn btn-primary'
                onClick={() => props.onRun(message)}
              >
                Run
              </button>
            </section>
            <section aria-label='Run result'>
              <label class='form-label'>Result</label>
              <div class='playground-result-panel'>
                {props.result ?? 'No result yet.'}
              </div>
            </section>
          </div>
        </div>
        <footer class='workbench-modal-footer'>
          <span class='text-muted'>Local preview only</span>
          <button type='button' class='btn btn-ghost' onClick={props.onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
