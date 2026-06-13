/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';
import PipelineWorkbench from '../islands/PipelineWorkbench.tsx';

interface PipelinesPageProps {
  currentPath: string;
  pipelines?: unknown;
  plugins?: string[];
}

export function PipelinesPage({ currentPath, pipelines, plugins }: PipelinesPageProps) {
  return (
    <Layout currentPath={currentPath} title='Pipelines'>
      <PipelineWorkbench initialPipelines={pipelines} initialPlugins={plugins} />
    </Layout>
  );
}
