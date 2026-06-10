/** @jsxImportSource preact */
import type { PipelineDirection } from './types.ts';

export function Toolbar(props: {
  direction: PipelineDirection;
  onDirectionChange(direction: PipelineDirection): void;
  onRun(): void;
  onLoad(): void;
  onSave(): void;
  onPublish(): void;
  onUndo(): void;
  onRedo(): void;
}) {
  return (
    <div class='pipeline-toolbar'>
      <button
        type='button'
        id='tab-client'
        class={props.direction === 'client' ? 'btn btn-primary pipeline-mode-tab' : 'btn btn-ghost pipeline-mode-tab'}
        data-pipeline='client'
        aria-pressed={props.direction === 'client'}
        onClick={() => props.onDirectionChange('client')}
      >
        Client
      </button>
      <button
        type='button'
        id='tab-server'
        class={props.direction === 'server' ? 'btn btn-primary pipeline-mode-tab' : 'btn btn-ghost pipeline-mode-tab'}
        data-pipeline='server'
        aria-pressed={props.direction === 'server'}
        onClick={() => props.onDirectionChange('server')}
      >
        Server
      </button>
      <button
        type='button'
        id='btn-undo-pipeline'
        class='btn btn-ghost'
        disabled
        onClick={props.onUndo}
      >
        ↶ Undo
      </button>
      <button
        type='button'
        id='btn-redo-pipeline'
        class='btn btn-ghost'
        disabled
        onClick={props.onRedo}
      >
        ↷ Redo
      </button>
      <button
        type='button'
        id='btn-run-pipeline'
        class='btn btn-ghost'
        disabled
        onClick={props.onRun}
      >
        ▷ Run
      </button>
      <button
        type='button'
        id='btn-load-dag'
        class='btn btn-ghost'
        disabled
        onClick={props.onLoad}
      >
        Load
      </button>
      <button
        type='button'
        id='btn-save-dag'
        class='btn btn-ghost'
        disabled
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
