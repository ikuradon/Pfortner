/** @jsxImportSource preact */
import { assertMatch, assertStringIncludes } from '@std/assert';
import { render } from 'preact-render-to-string';
import { Canvas } from './Canvas.tsx';
import type { PipelineGraph } from './types.ts';

const graph: PipelineGraph = {
  direction: 'client',
  nodes: [
    { id: 'client-start', type: 'start', policy: 'start', x: 0, y: 0 },
    { id: 'client-node-1', type: 'policy', policy: 'accept', x: 240, y: 80 },
  ],
  edges: [
    {
      id: 'client-edge-1',
      from: 'client-start',
      fromPort: 'next',
      to: 'client-node-1',
      toPort: 'in',
    },
  ],
};

Deno.test('Canvas renders viewport transform and minimap viewport from reducer state', () => {
  const html = render(
    <Canvas
      graph={graph}
      selectedNodeIds={['client-node-1']}
      viewport={{ zoom: 1.25, pan: { x: 56, y: 80 } }}
      canvasSize={{ width: 800, height: 480 }}
      onNodeDoubleClick={() => undefined}
    />,
  );

  assertStringIncludes(html, 'class="pipeline-viewport"');
  assertStringIncludes(html, 'transform="translate(56, 80) scale(1.25)"');
  assertStringIncludes(html, 'class="canvas-minimap"');
  assertStringIncludes(html, 'viewBox="0 0 160 96"');
  assertStringIncludes(html, 'class="minimap-viewport"');
  assertStringIncludes(html, 'class="minimap-node selected"');
});

Deno.test('Canvas renders node action controls for run and settings routes', () => {
  const html = render(
    <Canvas
      graph={graph}
      selectedNodeIds={[]}
      viewport={{ zoom: 1, pan: { x: 56, y: 80 } }}
      canvasSize={{ width: 800, height: 480 }}
      onNodeDoubleClick={() => undefined}
    />,
  );

  assertStringIncludes(html, 'class="pipeline-node-action"');
  assertStringIncludes(html, 'data-node-action="run"');
  assertStringIncludes(html, 'Run playground');
  assertStringIncludes(html, 'data-node-action="settings"');
  assertStringIncludes(html, 'Node settings');
  assertStringIncludes(html, 'class="pipeline-node-icon"');
  assertStringIncludes(html, '>▶</text>');
  assertStringIncludes(html, '>✓</text>');
  assertMatch(
    html,
    /class="pipeline-node-action-label"[^>]*>\s*▶\s*<\/text>/,
  );
  assertMatch(
    html,
    /class="pipeline-node-action-label"[^>]*>\s*⚙\s*<\/text>/,
  );
});

Deno.test('Canvas renders branch output ports for when and match nodes', () => {
  const html = render(
    <Canvas
      graph={{
        direction: 'client',
        nodes: [
          { id: 'client-start', type: 'start', policy: 'start', x: 0, y: 0 },
          {
            id: 'client-node-1',
            type: 'policy',
            policy: 'when',
            x: 240,
            y: 0,
            config: { condition: {}, then: [], else: [] },
          },
          {
            id: 'client-node-2',
            type: 'policy',
            policy: 'match',
            x: 240,
            y: 140,
            config: { cases: [{ condition: {}, pipeline: [] }], default: [] },
          },
        ],
        edges: [
          {
            id: 'client-edge-1',
            from: 'client-start',
            fromPort: 'next',
            to: 'client-node-1',
            toPort: 'in',
          },
        ],
      }}
      selectedNodeIds={[]}
      viewport={{ zoom: 1, pan: { x: 56, y: 80 } }}
      canvasSize={{ width: 800, height: 480 }}
      onNodeDoubleClick={() => undefined}
    />,
  );

  assertStringIncludes(html, 'data-node-id="client-node-1" data-port-id="then"');
  assertStringIncludes(html, 'data-node-id="client-node-1" data-port-id="else"');
  assertStringIncludes(html, 'data-node-id="client-node-2" data-port-id="case:0"');
  assertStringIncludes(html, 'data-node-id="client-node-2" data-port-id="default"');
  assertStringIncludes(html, 'data-node-id="client-node-1" data-port-id="in" data-port-role="input"');
  assertStringIncludes(html, 'data-port-name="then"');
  assertStringIncludes(html, 'data-port-name="case:0"');
  assertStringIncludes(html, 'height="96"');
});

Deno.test('Canvas restores legacy edge hit paths, wire preview, execution state, and config subtitles', () => {
  const html = render(
    <Canvas
      graph={{
        direction: 'client',
        nodes: [
          { id: 'client-start', type: 'start', policy: 'start', x: 0, y: 0 },
          {
            id: 'client-node-1',
            type: 'policy',
            policy: 'write-guard',
            x: 240,
            y: 80,
            config: { require_auth: true },
          },
        ],
        edges: [
          {
            id: 'client-edge-1',
            from: 'client-start',
            fromPort: 'next',
            to: 'client-node-1',
            toPort: 'in',
          },
        ],
      }}
      selectedNodeIds={[]}
      executionNodeIds={['client-node-1']}
      wirePreview={{
        from: 'client-start',
        fromPort: 'next',
        point: { x: 180, y: 36 },
      }}
      viewport={{ zoom: 1, pan: { x: 56, y: 80 } }}
      canvasSize={{ width: 800, height: 480 }}
      onNodeDoubleClick={() => undefined}
    />,
  );

  assertStringIncludes(html, 'class="pipeline-edge-hit"');
  assertStringIncludes(html, 'class="pipeline-edge pipeline-edge-preview"');
  assertStringIncludes(html, 'class="pipeline-node executed"');
  assertStringIncludes(html, 'require_auth:true');
});
