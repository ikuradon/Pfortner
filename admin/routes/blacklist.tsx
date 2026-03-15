/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface BlacklistPageProps {
  currentPath: string;
}

export function BlacklistPage({ currentPath }: BlacklistPageProps) {
  return (
    <Layout currentPath={currentPath} title='Blacklist'>
      <div class='page-header'>
        <h1 class='page-title'>Blacklist</h1>
        <button type='button' id='btn-refresh' class='btn btn-ghost'>
          ↺ Refresh
        </button>
      </div>

      {/* IP Blacklist */}
      <div class='chart-container' style='margin-bottom:24px'>
        <div class='chart-title'>IP Blacklist</div>

        <div class='flex gap-2 mb-4' style='align-items:flex-end'>
          <div class='form-group' style='margin:0;flex:1;max-width:360px'>
            <label class='form-label' for='ip-input'>IP Address</label>
            <input
              type='text'
              id='ip-input'
              class='form-input'
              placeholder='e.g. 192.168.1.100'
            />
          </div>
          <button type='button' id='btn-add-ip' class='btn btn-primary'>
            + Add
          </button>
        </div>

        <div id='ip-list-container'>
          <table class='table' id='ip-table'>
            <thead>
              <tr>
                <th>IP Address</th>
                <th style='width:100px'>Action</th>
              </tr>
            </thead>
            <tbody id='ip-tbody'>
              <tr>
                <td
                  colspan={2}
                  style='text-align:center;padding:24px;color:var(--color-text-muted)'
                >
                  Loading…
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Pubkey Blacklist */}
      <div class='chart-container'>
        <div class='chart-title'>Pubkey Blacklist</div>

        <div class='flex gap-2 mb-4' style='align-items:flex-end'>
          <div class='form-group' style='margin:0;flex:1;max-width:480px'>
            <label class='form-label' for='pubkey-input'>Pubkey (hex)</label>
            <input
              type='text'
              id='pubkey-input'
              class='form-input'
              placeholder='64-char hex pubkey…'
            />
          </div>
          <button type='button' id='btn-add-pubkey' class='btn btn-primary'>
            + Add
          </button>
        </div>

        <div id='pubkey-list-container'>
          <table class='table' id='pubkey-table'>
            <thead>
              <tr>
                <th>Pubkey</th>
                <th style='width:100px'>Action</th>
              </tr>
            </thead>
            <tbody id='pubkey-tbody'>
              <tr>
                <td
                  colspan={2}
                  style='text-align:center;padding:24px;color:var(--color-text-muted)'
                >
                  Loading…
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/blacklist.js' type='module'></script>
    </Layout>
  );
}
