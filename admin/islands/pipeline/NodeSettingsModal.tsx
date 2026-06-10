/** @jsxImportSource preact */
import type { PipelineNode } from './types.ts';

export function NodeSettingsModal(props: {
  node: PipelineNode;
  mode: 'interactive' | 'json';
  json: string;
  error: string;
  onModeChange(mode: 'interactive' | 'json'): void;
  onJsonChange(value: string): void;
  onApply(): void;
  onClose(): void;
}) {
  return (
    <div class='modal-backdrop'>
      <section
        class='workbench-modal node-settings-panel'
        role='dialog'
        aria-modal='true'
        aria-labelledby='node-settings-modal-title'
      >
        <header class='workbench-modal-header'>
          <div>
            <h2 id='node-settings-modal-title'>
              {props.node.policy ?? props.node.id}
            </h2>
            <span class='text-muted'>{props.node.id}</span>
          </div>
          <button
            type='button'
            class='btn btn-ghost btn-icon'
            aria-label='Close node settings'
            onClick={props.onClose}
          >
            X
          </button>
        </header>
        <div class='workbench-modal-body'>
          <div
            class='config-editor-tabs'
            role='group'
            aria-label='Settings mode'
          >
            <button
              type='button'
              class={props.mode === 'interactive' ? 'btn btn-primary' : 'btn btn-ghost'}
              aria-pressed={props.mode === 'interactive'}
              onClick={() => props.onModeChange('interactive')}
            >
              Interactive
            </button>
            <button
              type='button'
              class={props.mode === 'json' ? 'btn btn-primary' : 'btn btn-ghost'}
              aria-pressed={props.mode === 'json'}
              onClick={() => props.onModeChange('json')}
            >
              JSON
            </button>
          </div>
          <textarea
            class='config-editor-textarea modal-json-editor'
            aria-label='Settings JSON'
            value={props.json}
            onInput={(event) =>
              props.onJsonChange(
                (event.currentTarget as HTMLTextAreaElement).value,
              )}
          />
          {props.error ? <div class='modal-error' role='alert'>{props.error}</div> : null}
        </div>
        <footer class='workbench-modal-footer'>
          <span class='text-muted'>Node settings</span>
          <div class='modal-footer-actions'>
            <button type='button' class='btn btn-ghost' onClick={props.onClose}>
              Cancel
            </button>
            <button
              type='button'
              class='btn btn-primary'
              onClick={props.onApply}
            >
              Apply
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
