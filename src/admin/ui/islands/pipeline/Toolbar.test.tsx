/** @jsxImportSource preact */
import { assertEquals, assertStrictEquals } from '@std/assert';
import { Toolbar } from './Toolbar.tsx';
import { ViewportControls } from './ViewportControls.tsx';

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

Deno.test('Toolbar wires workbench action buttons to callbacks', () => {
  const calls: string[] = [];
  const toolbar = Toolbar({
    onLoad: () => calls.push('load'),
    onSave: () => calls.push('save'),
    onPublish: () => calls.push('publish'),
    onUndo: () => calls.push('undo'),
    onRedo: () => calls.push('redo'),
    canUndo: true,
    canRedo: true,
  }) as VNodeLike;

  click(findById(toolbar, 'btn-undo-pipeline'));
  click(findById(toolbar, 'btn-redo-pipeline'));
  click(findById(toolbar, 'btn-load-dag'));
  click(findById(toolbar, 'btn-save-dag'));
  click(findById(toolbar, 'btn-publish-pipeline'));

  assertEquals(calls, ['undo', 'redo', 'load', 'save', 'publish']);
  assertStrictEquals(findById(toolbar, 'btn-undo-pipeline')?.props?.disabled, false);
  assertStrictEquals(findById(toolbar, 'btn-fit-canvas'), null);
  assertStrictEquals(findById(toolbar, 'btn-run-pipeline'), null);
});

Deno.test('ViewportControls wires canvas viewport buttons to callbacks', () => {
  const calls: string[] = [];
  const controls = ViewportControls({
    onFit: () => calls.push('fit'),
    onZoomOut: () => calls.push('zoom-out'),
    onZoomIn: () => calls.push('zoom-in'),
  }) as VNodeLike;

  click(findById(controls, 'btn-fit-canvas'));
  click(findById(controls, 'btn-zoom-out'));
  click(findById(controls, 'btn-zoom-in'));

  assertEquals(calls, ['fit', 'zoom-out', 'zoom-in']);
  assertStrictEquals(findById(controls, 'btn-fit-canvas')?.props?.disabled, undefined);
});
