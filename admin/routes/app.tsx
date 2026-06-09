/** @jsxImportSource preact */
import { Sidebar } from '../components/Sidebar.tsx';

interface AdminAppShellProps {
  currentPath: string;
}

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('pfortner-theme');` +
  `if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){` +
  `document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

export function AdminAppShell({ currentPath }: AdminAppShellProps) {
  return (
    <html lang='en'>
      <head>
        <meta charset='UTF-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1.0' />
        <title>Pförtner Admin</title>
        <link rel='stylesheet' href='/admin/static/styles.css' />
        {/* deno-lint-ignore -- safe: hardcoded string literal, no user input */}
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
        <script src='/admin/static/client.js' type='module'></script>
        <script src='/admin/static/utils.js'></script>
        <script src='/admin/static/app.js' type='module'></script>
      </body>
    </html>
  );
}
