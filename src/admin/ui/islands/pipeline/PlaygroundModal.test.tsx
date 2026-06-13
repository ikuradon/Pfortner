/** @jsxImportSource preact */
import { assertStringIncludes } from '@std/assert';
import { render } from 'preact-render-to-string';
import { PlaygroundModal } from './PlaygroundModal.tsx';

Deno.test('PlaygroundModal renders integrated workbench playground controls', () => {
  const html = render(
    <PlaygroundModal
      nodeId='client-start'
      direction='client'
      onRun={() => undefined}
      onClose={() => undefined}
    />,
  );

  assertStringIncludes(html, 'Pipeline Playground');
  assertStringIncludes(html, 'id="test-run-summary"');
  assertStringIncludes(html, 'Client pipeline');
  assertStringIncludes(html, 'Presets');
  assertStringIncludes(html, 'data-preset="event-1"');
  assertStringIncludes(html, 'data-preset="req-basic"');
  assertStringIncludes(html, '>event-1</button>');
  assertStringIncludes(html, 'id="playground-message-input"');
  assertStringIncludes(html, 'Context');
  assertStringIncludes(html, 'id="ctx-authenticated"');
  assertStringIncludes(html, 'id="ctx-pubkey"');
  assertStringIncludes(html, 'id="ctx-ip"');
  assertStringIncludes(html, 'id="btn-run"');
  assertStringIncludes(html, '▷ Run');
  assertStringIncludes(html, 'Results');
  assertStringIncludes(html, 'Run a message to inspect the evaluated path.');
});

Deno.test('PlaygroundModal renders structured execution steps and final result', () => {
  const html = render(
    <PlaygroundModal
      nodeId='client-start'
      direction='client'
      result={{
        steps: [
          {
            policy: 'write-guard',
            action: 'reject',
            detail: 'authentication required',
            response: 'AUTH required',
          },
        ],
        finalAction: 'reject',
        finalResponse: 'blocked',
      }}
      onRun={() => undefined}
      onClose={() => undefined}
    />,
  );

  assertStringIncludes(html, 'class="step-list"');
  assertStringIncludes(html, 'write-guard');
  assertStringIncludes(html, 'REJECT');
  assertStringIncludes(html, 'authentication required');
  assertStringIncludes(html, 'Response: AUTH required');
  assertStringIncludes(html, 'class="final-result reject"');
  assertStringIncludes(html, 'Final: REJECT');
  assertStringIncludes(html, 'blocked');
});
