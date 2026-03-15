/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface PlaceholderPageProps {
  currentPath: string;
}

export function BlacklistPage({ currentPath }: PlaceholderPageProps) {
  return (
    <Layout currentPath={currentPath} title='Blacklist'>
      <div class='page-header'>
        <h1 class='page-title'>Blacklist</h1>
      </div>
      <div class='placeholder'>
        <h2>Coming Soon</h2>
        <p class='text-muted'>This page is under construction.</p>
      </div>
    </Layout>
  );
}
