/** @jsxImportSource preact */
import { Partial } from '@fresh/core/runtime';
import type { ComponentChildren } from 'preact';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/admin/', label: 'Dashboard', icon: '◈' },
  { href: '/admin/connections', label: 'Connections', icon: '⟺' },
  { href: '/admin/pipelines', label: 'Pipelines', icon: '⫶' },
  { href: '/admin/metrics', label: 'Metrics', icon: '∿' },
  { href: '/admin/blocklist', label: 'Blocklist', icon: '⊘' },
  { href: '/admin/config', label: 'Config', icon: '⚙' },
  { href: '/admin/logs', label: 'Logs', icon: '≡' },
];

interface SidebarProps {
  currentPath: string;
}

export function Sidebar({ currentPath }: SidebarProps) {
  return (
    <aside class='sidebar'>
      <div class='sidebar-logo'>
        Pf<span>ö</span>rtner
      </div>
      <nav class='sidebar-nav'>
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            class={currentPath === item.href ||
                (item.href !== '/admin/' && currentPath.startsWith(item.href))
              ? 'active'
              : ''}
          >
            <span style='width:18px;text-align:center'>{item.icon}</span>
            {item.label}
          </a>
        ))}
      </nav>
      <div class='sidebar-footer'>
        <span class='text-muted' style='font-size:11px'>
          Admin Panel
        </span>
        <div id='theme-toggle-mount'></div>
      </div>
    </aside>
  );
}

interface LayoutProps {
  currentPath: string;
  title: string;
  children: ComponentChildren;
}

// Theme init script — hardcoded string literal only, no user input (safe, prevents FOUC)
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('pfortner-theme');` +
  `if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){` +
  `document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

export function Layout({ currentPath, title, children }: LayoutProps) {
  return (
    <html lang='en'>
      <head>
        <meta charset='UTF-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1.0' />
        <title>{title} — Pförtner Admin</title>
        <link rel='stylesheet' href='/admin/static/styles.css' />
        {/* deno-lint-ignore -- safe: hardcoded string literal, no user input */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body {...{ 'f-client-nav': true }}>
        <div class='layout'>
          <Partial name='admin-sidebar'>
            <Sidebar currentPath={currentPath} />
          </Partial>
          <main class='main-content'>
            <Partial name='admin-content'>
              {children}
            </Partial>
          </main>
        </div>
        <script src='/admin/static/client.js' type='module'></script>
      </body>
    </html>
  );
}
