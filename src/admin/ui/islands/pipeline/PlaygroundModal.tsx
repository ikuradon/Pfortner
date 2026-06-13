/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import type { PipelineDirection, PlaygroundConnectionInfo, PlaygroundRunRequest } from './types.ts';

type PresetId =
  | 'event-1'
  | 'event-4'
  | 'event-1059'
  | 'req-basic'
  | 'req-search'
  | 'close';

const PRESET_BUTTONS: Array<{ id: PresetId; label: string }> = [
  { id: 'event-1', label: 'event-1' },
  { id: 'event-4', label: 'event-4' },
  { id: 'event-1059', label: 'event-1059' },
  { id: 'req-basic', label: 'req-basic' },
  { id: 'req-search', label: 'req-search' },
  { id: 'close', label: 'close' },
];

function eventPreset(kind: number, content: string): unknown[] {
  return [
    'EVENT',
    {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pubkey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      created_at: Math.floor(Date.now() / 1000),
      kind,
      tags: kind === 1 ? [] : [['p', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff']],
      content,
      sig:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
  ];
}

function presetMessage(id: PresetId): string {
  const value = (() => {
    if (id === 'event-1') return eventPreset(1, 'Hello Nostr!');
    if (id === 'event-4') return eventPreset(4, 'encrypted DM content');
    if (id === 'event-1059') return eventPreset(1059, 'gift wrap');
    if (id === 'req-basic') return ['REQ', 'sub1', { kinds: [1], limit: 10 }];
    if (id === 'req-search') return ['REQ', 'sub2', { kinds: [1], search: 'hello', limit: 10 }];
    return ['CLOSE', 'sub1'];
  })();
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function actionClass(action: string): string {
  if (action === 'accept' || action === 'reject') return action;
  return 'next';
}

function circleChar(action: string): string {
  if (action === 'accept') return '✓';
  if (action === 'reject') return '✕';
  return '→';
}

export function PlaygroundModal(props: {
  nodeId: string | null;
  direction: PipelineDirection;
  message?: string;
  connectionInfo?: PlaygroundConnectionInfo;
  result?: unknown;
  error?: string;
  onMessageChange?(message: string): void;
  onConnectionInfoChange?(connectionInfo: PlaygroundConnectionInfo): void;
  onRun(request: PlaygroundRunRequest): void | Promise<void>;
  onClose(): void;
}) {
  const message = props.message ?? '';
  const connectionInfo = props.connectionInfo ?? {
    authenticated: false,
    pubkey: '',
    clientIp: '127.0.0.1',
  };
  const [running, setRunning] = useState(false);

  const setConnectionInfo = (patch: Partial<PlaygroundConnectionInfo>) => {
    props.onConnectionInfoChange?.({
      ...connectionInfo,
      ...patch,
    });
  };

  const run = async () => {
    setRunning(true);
    try {
      await props.onRun({
        message,
        direction: props.direction,
        connectionInfo: {
          authenticated: connectionInfo.authenticated,
          pubkey: connectionInfo.pubkey.trim(),
          clientIp: connectionInfo.clientIp.trim() || '127.0.0.1',
        },
      });
    } finally {
      setRunning(false);
    }
  };

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
            <h2 id='playground-modal-title'>Pipeline Playground</h2>
            <span class='text-muted' id='test-run-summary'>
              {props.direction === 'client' ? 'Client pipeline' : 'Server pipeline'}
            </span>
          </div>
          <button
            type='button'
            class='btn btn-ghost'
            aria-label='Close playground'
            onClick={props.onClose}
          >
            Close
          </button>
        </header>
        <div class='workbench-modal-body playground-modal-body'>
          <div class='playground-modal-grid'>
            <section class='test-run-inputs' aria-label='Message input'>
              <div>
                <div class='section-title'>Presets</div>
                <div class='preset-buttons' id='preset-buttons'>
                  {PRESET_BUTTONS.map((preset) => (
                    <button
                      key={preset.id}
                      type='button'
                      class='preset-btn'
                      data-preset={preset.id}
                      onClick={() =>
                        props.onMessageChange?.(
                          presetMessage(preset.id),
                        )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div class='playground-message-block'>
                <label class='section-title' for='playground-message-input'>
                  Message
                </label>
                <textarea
                  id='playground-message-input'
                  class='message-textarea'
                  spellcheck={false}
                  placeholder='["EVENT", {...}]'
                  value={message}
                  onInput={(event) =>
                    props.onMessageChange?.(
                      (event.currentTarget as HTMLTextAreaElement).value,
                    )}
                  onKeyDown={(event) => {
                    if (event.ctrlKey && event.key === 'Enter') {
                      event.preventDefault();
                      void run();
                    }
                  }}
                />
              </div>
              <div>
                <div class='section-title'>Context</div>
                <div class='context-grid'>
                  <label class='context-label' for='ctx-authenticated'>
                    Authenticated
                  </label>
                  <input
                    type='checkbox'
                    id='ctx-authenticated'
                    checked={connectionInfo.authenticated}
                    onInput={(event) =>
                      setConnectionInfo({
                        authenticated: (event.currentTarget as HTMLInputElement)
                          .checked,
                      })}
                  />
                  <label class='context-label' for='ctx-pubkey'>Pubkey</label>
                  <input
                    type='text'
                    id='ctx-pubkey'
                    class='context-input'
                    placeholder='(hex pubkey)'
                    value={connectionInfo.pubkey}
                    onInput={(event) =>
                      setConnectionInfo({
                        pubkey: (event.currentTarget as HTMLInputElement).value,
                      })}
                  />
                  <label class='context-label' for='ctx-ip'>Client IP</label>
                  <input
                    type='text'
                    id='ctx-ip'
                    class='context-input'
                    placeholder='127.0.0.1'
                    value={connectionInfo.clientIp}
                    onInput={(event) =>
                      setConnectionInfo({
                        clientIp: (event.currentTarget as HTMLInputElement)
                          .value,
                      })}
                  />
                </div>
              </div>
              <button
                type='button'
                class='btn btn-primary'
                id='btn-run'
                data-modal-action='run-playground'
                disabled={running}
                onClick={() => void run()}
              >
                {running ? 'Running...' : '▷ Run'}
              </button>
            </section>
            <section class='test-run-results' aria-label='Run result'>
              <div class='section-title'>Results</div>
              <div class='playground-result-panel' id='result-panel'>
                <PlaygroundResult result={props.result} error={props.error} />
              </div>
            </section>
          </div>
        </div>
        <footer class='workbench-modal-footer'>
          <span class='text-muted'>API evaluation</span>
          <button type='button' class='btn btn-ghost' onClick={props.onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

function PlaygroundResult(props: { result?: unknown; error?: string }) {
  if (props.error) {
    return (
      <div class='playground-error' role='alert'>
        {props.error}
      </div>
    );
  }

  if (props.result === undefined) {
    return (
      <div class='playground-empty' id='result-empty'>
        Run a message to inspect the evaluated path.
      </div>
    );
  }

  if (!isRecord(props.result) || !Array.isArray(props.result.steps)) {
    return <div class='playground-error'>Invalid response from server</div>;
  }

  const steps = props.result.steps;
  const finalAction = textValue(props.result.finalAction, 'accept');
  const finalResponse = textValue(props.result.finalResponse);

  return (
    <>
      {steps.length === 0
        ? (
          <div class='playground-empty'>
            Pipeline is empty — message would pass through.
          </div>
        )
        : (
          <div class='step-list'>
            {steps.map((step, index) => (
              <StepItem
                key={index}
                step={step}
                isLast={index === steps.length - 1}
              />
            ))}
          </div>
        )}
      <div class={`final-result ${finalAction === 'accept' ? 'accept' : 'reject'}`}>
        Final: {finalAction.toUpperCase()}
        {finalResponse ? <div class='final-response'>{finalResponse}</div> : null}
      </div>
    </>
  );
}

function StepItem(props: { step: unknown; isLast: boolean }) {
  const step = isRecord(props.step) ? props.step : {};
  const action = textValue(step.action, 'next');
  const policy = textValue(step.policy, 'unknown');
  const branch = textValue(step.branch);
  const detail = textValue(step.detail);
  const response = textValue(step.response);
  const className = actionClass(action);

  return (
    <div class='step-item'>
      <div class='step-line'>
        <div class={`step-circle ${className}`}>
          {circleChar(action)}
        </div>
        {props.isLast ? null : <div class='step-connector'></div>}
      </div>
      <div class='step-content'>
        <div>
          <span class='step-policy-name'>{policy}</span>
          <span class={`step-action-badge ${className}`}>
            {action.toUpperCase()}
          </span>
          {branch ? <span class='step-action-badge next'>{branch}</span> : null}
        </div>
        {detail ? <div class='step-detail'>{detail}</div> : null}
        {response ? <div class='step-response'>Response: {response}</div> : null}
      </div>
    </div>
  );
}
