/** @jsxImportSource preact */
import { render } from 'preact';
import PipelineWorkbench from './PipelineWorkbench.tsx';

interface PipelineWorkbenchBrowserProps {
  initialPipelines?: unknown;
  initialPlugins?: string[];
}

type MountableWorkbench = (() => null) & {
  mount?: (root: ParentNode, props?: unknown) => void;
  unmount?: (root: ParentNode) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unpackFreshJsonValue(
  values: unknown[],
  hydrated: unknown[],
  ref: number,
): unknown {
  if (ref === -1) return undefined;
  if (ref === -2) return null;
  if (ref in hydrated) return hydrated[ref];

  const current = values[ref];
  if (
    current === null ||
    typeof current === 'string' ||
    typeof current === 'number' ||
    typeof current === 'boolean'
  ) {
    hydrated[ref] = current;
    return current;
  }

  if (Array.isArray(current)) {
    const actual: unknown[] = [];
    hydrated[ref] = actual;
    for (const itemRef of current) {
      if (itemRef === -7) {
        actual.length += 1;
        continue;
      }
      actual.push(unpackFreshJsonValue(values, hydrated, Number(itemRef)));
    }
    return actual;
  }

  if (isRecord(current)) {
    const actual: Record<string, unknown> = {};
    hydrated[ref] = actual;
    for (const [key, itemRef] of Object.entries(current)) {
      actual[key] = unpackFreshJsonValue(values, hydrated, Number(itemRef));
    }
    return actual;
  }

  return undefined;
}

function parseFreshJsonValue(value: string): unknown {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) return parsed;
  return unpackFreshJsonValue(parsed, [], 0);
}

export function propsFromFreshBootValue(value: unknown): PipelineWorkbenchBrowserProps {
  const decoded = typeof value === 'string' ? parseFreshJsonValue(value) : value;
  const props = Array.isArray(decoded) && isRecord(decoded[0]) && isRecord(decoded[0].props)
    ? decoded[0].props
    : decoded;
  return propsFromValue(props);
}

function propsFromValue(value: unknown): PipelineWorkbenchBrowserProps {
  if (!isRecord(value)) return {};
  const initialPlugins = Array.isArray(value.initialPlugins)
    ? value.initialPlugins.filter((item): item is string => typeof item === 'string')
    : undefined;

  return {
    initialPipelines: value.initialPipelines,
    initialPlugins,
  };
}

export function mountPipelineWorkbench(root: ParentNode, rawProps: unknown = {}): void {
  const placeholder = root.querySelector?.('#pipeline-workbench') as HTMLElement | null;
  if (!placeholder || placeholder.dataset.pfortnerPreactMounted === 'true') return;

  const ownerDocument = placeholder.ownerDocument ??
    ('createElement' in root ? root : globalThis.document);
  const mountPoint = ownerDocument.createElement('div');
  mountPoint.setAttribute('data-pipeline-workbench-mount', 'true');
  if (typeof placeholder.replaceWith === 'function') {
    placeholder.replaceWith(mountPoint);
  } else {
    placeholder.parentNode?.insertBefore(mountPoint, placeholder);
    placeholder.parentNode?.removeChild(placeholder);
  }

  render(<PipelineWorkbench {...propsFromFreshBootValue(rawProps)} />, mountPoint);

  const workbench = mountPoint.querySelector('#pipeline-workbench') as HTMLElement | null;
  if (!workbench) return;
  workbench.dataset.mounted = 'true';
  workbench.dataset.pfortnerPreactMounted = 'true';
}

export function unmountPipelineWorkbench(root: ParentNode): void {
  const mountPoint = root.querySelector?.('[data-pipeline-workbench-mount="true"]') as HTMLElement | null;
  if (!mountPoint) return;
  render(null, mountPoint);
}

const PipelineWorkbenchBrowser = (() => null) as MountableWorkbench;
PipelineWorkbenchBrowser.mount = mountPipelineWorkbench;
PipelineWorkbenchBrowser.unmount = unmountPipelineWorkbench;

export default PipelineWorkbenchBrowser;
