/** @jsxImportSource preact */

// Theme init script — hardcoded string literal only, no user input (safe, prevents FOUC)
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('pfortner-theme');` +
  `if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){` +
  `document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

interface LoginPageProps {
  error?: string;
}

export function LoginPage({ error }: LoginPageProps) {
  return (
    <html lang='en'>
      <head>
        <meta charset='UTF-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1.0' />
        <title>Login — Pförtner Admin</title>
        <link rel='stylesheet' href='/admin/static/styles.css' />
        {/* deno-lint-ignore -- safe: hardcoded string literal, no user input */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div class='login-container'>
          <div class='login-card'>
            <div class='login-title'>Pförtner</div>
            <div class='login-subtitle'>Admin Panel</div>
            {error && <div class='alert alert-error'>{error}</div>}
            <form method='POST' action='/admin/login'>
              <div class='form-group'>
                <label class='form-label' for='token'>
                  Access Token
                </label>
                <input
                  id='token'
                  name='token'
                  type='password'
                  class='form-input'
                  placeholder='Enter admin token...'
                  required
                  autofocus
                />
              </div>
              <button type='submit' class='btn btn-primary' style='width:100%;justify-content:center'>
                Sign In
              </button>
            </form>
          </div>
        </div>
      </body>
    </html>
  );
}
