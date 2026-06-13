/** @jsxImportSource preact */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { render } from 'preact-render-to-string';
import { NodeSettingsModal } from './NodeSettingsModal.tsx';

type VNodeLike = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

function vnodeChildren(value: unknown): VNodeLike[] {
  if (Array.isArray(value)) {
    return value.flatMap(vnodeChildren);
  }
  return value !== null && typeof value === 'object' ? [value as VNodeLike] : [];
}

function childrenOf(node: VNodeLike): VNodeLike[] {
  if (Array.isArray(node)) {
    return node.flatMap(vnodeChildren);
  }
  if (typeof node.type === 'function') {
    const rendered = node.type(node.props ?? {}) as VNodeLike;
    return vnodeChildren(rendered);
  }
  return vnodeChildren(node.props?.children);
}

function findByModalAction(node: VNodeLike, action: string): VNodeLike | null {
  if (node.props?.['data-modal-action'] === action) return node;
  for (const child of childrenOf(node)) {
    const match = findByModalAction(child, action);
    if (match) return match;
  }
  return null;
}

function findByProp(node: VNodeLike, key: string, value: unknown): VNodeLike | null {
  if (node.props?.[key] === value) return node;
  for (const child of childrenOf(node)) {
    const match = findByProp(child, key, value);
    if (match) return match;
  }
  return null;
}

function findAllByProp(node: VNodeLike, key: string, value: unknown): VNodeLike[] {
  const matches = node.props?.[key] === value ? [node] : [];
  for (const child of childrenOf(node)) {
    matches.push(...findAllByProp(child, key, value));
  }
  return matches;
}

function click(node: VNodeLike | null): void {
  const onClick = node?.props?.onClick;
  if (typeof onClick === 'function') onClick();
}

function input(node: VNodeLike | null, value: unknown): void {
  const onInput = node?.props?.onInput;
  if (typeof onInput === 'function') {
    onInput({ currentTarget: { value, checked: value } });
  }
}

Deno.test('NodeSettingsModal renders and wires delete node action', () => {
  const calls: string[] = [];
  const props = {
    node: {
      id: 'client-node-1',
      type: 'policy',
      policy: 'accept',
      config: {},
    },
    mode: 'json' as const,
    json: '{}',
    error: '',
    onModeChange: () => calls.push('mode'),
    onJsonChange: () => calls.push('json'),
    onApply: () => calls.push('apply'),
    onDelete: () => calls.push('delete'),
    onClose: () => calls.push('close'),
  };
  const html = render(<NodeSettingsModal {...props} />);
  const vnode = NodeSettingsModal(props) as VNodeLike;

  assertStringIncludes(html, 'data-modal-action="delete-node"');
  assertStringIncludes(html, 'Delete Node');

  click(findByModalAction(vnode, 'delete-node'));

  assertEquals(calls, ['delete']);
});

Deno.test('NodeSettingsModal renders interactive config rows and updates JSON', () => {
  const jsonUpdates: string[] = [];
  const props = {
    node: {
      id: 'client-node-1',
      type: 'policy',
      policy: 'write-guard',
      config: { require_auth: true },
    },
    mode: 'interactive' as const,
    json: JSON.stringify({ require_auth: true, window: 60 }, null, 2),
    error: '',
    onModeChange: () => undefined,
    onJsonChange: (value: string) => jsonUpdates.push(value),
    onApply: () => undefined,
    onDelete: () => undefined,
    onClose: () => undefined,
  };
  const html = render(<NodeSettingsModal {...props} />);
  const vnode = NodeSettingsModal(props) as VNodeLike;

  assertStringIncludes(html, 'data-config-row-key="require_auth"');
  assertStringIncludes(html, 'data-config-row-key="window"');
  assertStringIncludes(html, 'data-config-field="require_auth"');
  assertEquals(html.includes('aria-label="Settings JSON"'), false);

  const windowField = findByProp(vnode, 'data-config-field', 'window');
  assert(windowField);

  input(windowField, '120');

  assertEquals(JSON.parse(jsonUpdates.at(-1) ?? '{}'), {
    require_auth: true,
    window: 120,
  });
});

Deno.test('NodeSettingsModal restores legacy empty and boolean interactive labels', () => {
  const html = render(
    <NodeSettingsModal
      node={{
        id: 'client-node-1',
        type: 'policy',
        policy: 'write-guard',
        config: {},
      }}
      mode='interactive'
      json='{"require_auth":true}'
      error=''
      onModeChange={() => undefined}
      onJsonChange={() => undefined}
      onApply={() => undefined}
      onDelete={() => undefined}
      onClose={() => undefined}
    />,
  );

  assertStringIncludes(html, 'data-config-row-key="require_auth"');
  assertStringIncludes(html, '>true</span>');

  const emptyHtml = render(
    <NodeSettingsModal
      node={{
        id: 'client-node-2',
        type: 'policy',
        policy: 'accept',
        config: {},
      }}
      mode='interactive'
      json='{}'
      error=''
      onModeChange={() => undefined}
      onJsonChange={() => undefined}
      onApply={() => undefined}
      onDelete={() => undefined}
      onClose={() => undefined}
    />,
  );

  assertStringIncludes(emptyHtml, 'No config fields.');
});

Deno.test('NodeSettingsModal renders match case controls and emits case index maps', () => {
  const updates: Array<{ json: string; caseIndexMap?: Array<number | null> | null }> = [];
  const props = {
    node: {
      id: 'client-node-1',
      type: 'policy',
      policy: 'match',
      config: {
        cases: [
          { condition: { kind: 1 }, pipeline: [] },
          { condition: { kind: 2 }, pipeline: [] },
        ],
        default: [],
      },
    },
    mode: 'interactive' as const,
    json: JSON.stringify(
      {
        cases: [
          { condition: { kind: 1 }, pipeline: [] },
          { condition: { kind: 2 }, pipeline: [] },
        ],
        default: [],
      },
      null,
      2,
    ),
    error: '',
    caseIndexMap: [0, 1],
    onModeChange: () => undefined,
    onJsonChange: (json: string, caseIndexMap?: Array<number | null> | null) => {
      updates.push({ json, caseIndexMap });
    },
    onApply: () => undefined,
    onDelete: () => undefined,
    onClose: () => undefined,
  };
  const html = render(<NodeSettingsModal {...props} />);
  const vnode = NodeSettingsModal(props) as VNodeLike;

  assertStringIncludes(html, '+ Case');
  assertStringIncludes(html, 'Remove case 1');
  assertStringIncludes(html, 'Remove case 2');

  click(findAllByProp(vnode, 'data-config-action', 'remove-match-case')[0]);
  assertEquals(JSON.parse(updates.at(-1)?.json ?? '{}'), {
    cases: [{ condition: { kind: 2 }, pipeline: [] }],
    default: [],
  });
  assertEquals(updates.at(-1)?.caseIndexMap, [1]);

  click(findByProp(vnode, 'data-config-action', 'add-match-case'));
  assertEquals(JSON.parse(updates.at(-1)?.json ?? '{}').cases.length, 3);
  assertEquals(updates.at(-1)?.caseIndexMap, [0, 1, null]);
});
