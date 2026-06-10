/** @jsxImportSource preact */
import { assertEquals, assertStringIncludes } from '@std/assert';
import { render } from 'preact-render-to-string';
import { NodeSettingsModal } from './NodeSettingsModal.tsx';

type VNodeLike = {
  props?: Record<string, unknown> & { children?: unknown };
};

function childrenOf(node: VNodeLike): VNodeLike[] {
  const children = node.props?.children;
  if (Array.isArray(children)) {
    return children.filter((child): child is VNodeLike => child !== null && typeof child === 'object');
  }
  return children !== null && typeof children === 'object' ? [children as VNodeLike] : [];
}

function findByModalAction(node: VNodeLike, action: string): VNodeLike | null {
  if (node.props?.['data-modal-action'] === action) return node;
  for (const child of childrenOf(node)) {
    const match = findByModalAction(child, action);
    if (match) return match;
  }
  return null;
}

function click(node: VNodeLike | null): void {
  const onClick = node?.props?.onClick;
  if (typeof onClick === 'function') onClick();
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
