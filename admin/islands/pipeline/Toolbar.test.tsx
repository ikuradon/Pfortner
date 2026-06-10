/** @jsxImportSource preact */
import { assertEquals, assertStrictEquals } from '@std/assert';
import { Toolbar } from './Toolbar.tsx';

type VNodeLike = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

function childrenOf(node: VNodeLike): VNodeLike[] {
  const children = node.props?.children;
  if (Array.isArray(children)) {
    return children.filter((child): child is VNodeLike => child !== null && typeof child === 'object');
  }
  return children !== null && typeof children === 'object' ? [children as VNodeLike] : [];
}

function findById(node: VNodeLike, id: string): VNodeLike | null {
  if (node.props?.id === id) return node;
  for (const child of childrenOf(node)) {
    const match = findById(child, id);
    if (match) return match;
  }
  return null;
}

function click(node: VNodeLike | null): void {
  const onClick = node?.props?.onClick;
  if (typeof onClick === 'function') onClick();
}

Deno.test('Toolbar wires viewport control buttons to callbacks', () => {
  const calls: string[] = [];
  const toolbar = Toolbar({
    onRun: () => calls.push('run'),
    onLoad: () => calls.push('load'),
    onSave: () => calls.push('save'),
    onPublish: () => calls.push('publish'),
    onUndo: () => calls.push('undo'),
    onRedo: () => calls.push('redo'),
    onFit: () => calls.push('fit'),
    onZoomOut: () => calls.push('zoom-out'),
    onZoomIn: () => calls.push('zoom-in'),
    canUndo: true,
    canRedo: true,
  }) as VNodeLike;

  click(findById(toolbar, 'btn-fit-canvas'));
  click(findById(toolbar, 'btn-zoom-out'));
  click(findById(toolbar, 'btn-zoom-in'));

  assertEquals(calls, ['fit', 'zoom-out', 'zoom-in']);
  assertStrictEquals(findById(toolbar, 'btn-fit-canvas')?.props?.disabled, undefined);
});
