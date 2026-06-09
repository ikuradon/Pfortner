/** @jsxImportSource preact */
import { Sidebar } from '../components/Sidebar.tsx';

interface AdminAppShellProps {
  currentPath: string;
}

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('pfortner-theme');` +
  `if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){` +
  `document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

const ADMIN_STATIC_VERSION = '2026-06-09-spa-cache-1';

function adminStatic(path: string): string {
  return `/admin/static/${path}?v=${ADMIN_STATIC_VERSION}`;
}

export function AdminAppShell({ currentPath }: AdminAppShellProps) {
  return (
    <html lang='en'>
      <head>
        <meta charset='UTF-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1.0' />
        <title>Pförtner Admin</title>
        <link rel='stylesheet' href={adminStatic('styles.css')} />
        {/* deno-lint-ignore -- 安全: 固定文字列のみで user input を含まない */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div class='layout'>
          <Sidebar currentPath={currentPath} />
          <main class='main-content' id='admin-app'>
            <div class='placeholder'>
              <h2>Loading…</h2>
            </div>
          </main>
        </div>
        <script src={adminStatic('client.js')} type='module'></script>
        <script src={adminStatic('utils.js')}></script>
        <script src={adminStatic('app.js')} type='module'></script>
      </body>
    </html>
  );
}
