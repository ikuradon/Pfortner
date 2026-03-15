/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface PlaceholderPageProps {
  currentPath: string;
}

export function MetricsPage({ currentPath }: PlaceholderPageProps) {
  return (
    <Layout currentPath={currentPath} title='Metrics'>
      <div class='page-header'>
        <h1 class='page-title'>Metrics</h1>
      </div>
      <div class='placeholder'>
        <h2>Coming Soon</h2>
        <p class='text-muted'>This page is under construction.</p>
      </div>
    </Layout>
  );
}
