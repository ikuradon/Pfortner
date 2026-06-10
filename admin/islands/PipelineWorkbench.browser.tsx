/** @jsxImportSource preact */
import { render } from 'preact';
import PipelineWorkbench from './PipelineWorkbench.tsx';

interface PipelineWorkbenchBrowserProps {
  initialPipelines?: unknown;
  initialPlugins?: string[];
}

type MountableWorkbench = (() => null) & {
  mount?: (root: ParentNode, props?: unknown) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

  const mountPoint = placeholder.ownerDocument.createElement('div');
  mountPoint.setAttribute('data-pipeline-workbench-mount', 'true');
  placeholder.replaceWith(mountPoint);

  render(<PipelineWorkbench {...propsFromValue(rawProps)} />, mountPoint);

  const workbench = mountPoint.querySelector('#pipeline-workbench') as HTMLElement | null;
  if (!workbench) return;
  workbench.dataset.mounted = 'true';
  workbench.dataset.pfortnerPreactMounted = 'true';
}

const PipelineWorkbenchBrowser = (() => null) as MountableWorkbench;
PipelineWorkbenchBrowser.mount = mountPipelineWorkbench;

export default PipelineWorkbenchBrowser;
