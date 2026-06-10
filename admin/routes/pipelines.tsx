/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';
import PipelineWorkbench from '../islands/PipelineWorkbench.tsx';

interface PipelinesPageProps {
  currentPath: string;
}

export function PipelinesPage({ currentPath }: PipelinesPageProps) {
  return (
    <Layout currentPath={currentPath} title='Pipelines'>
      <div class='page-header'>
        <h1 class='page-title'>Pipelines</h1>
      </div>
      <PipelineWorkbench />
    </Layout>
  );
}
