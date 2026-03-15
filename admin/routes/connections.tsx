/** @jsxImportSource preact */
import { Layout } from '../components/Sidebar.tsx';

interface ConnectionsPageProps {
  currentPath: string;
}

export function ConnectionsPage({ currentPath }: ConnectionsPageProps) {
  return (
    <Layout currentPath={currentPath} title='Connections'>
      <div class='page-header'>
        <h1 class='page-title'>Connections</h1>
        <div class='flex gap-2'>
          <button type='button' id='btn-refresh' class='btn btn-ghost'>
            ↺ Refresh
          </button>
          <button
            type='button'
            id='btn-disconnect-selected'
            class='btn btn-danger'
            disabled
          >
            ✕ Disconnect Selected
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div class='stats-grid' id='conn-summary'>
        <div class='card'>
          <div class='card-title'>Total</div>
          <div class='card-value' id='summary-total'>—</div>
        </div>
        <div class='card'>
          <div class='card-title'>Authenticated</div>
          <div class='card-value' id='summary-authed'>—</div>
        </div>
        <div class='card'>
          <div class='card-title'>Unauthenticated</div>
          <div class='card-value' id='summary-unauthed'>—</div>
        </div>
      </div>

      {/* Filters */}
      <div class='card' style='margin-bottom:16px'>
        <div class='flex gap-2 items-center' style='flex-wrap:wrap'>
          <input
            type='text'
            id='search-input'
            class='form-input'
            placeholder='Filter by IP or pubkey…'
            style='flex:1;min-width:200px;max-width:360px'
          />
          <div class='flex gap-2'>
            <button
              type='button'
              class='btn btn-primary auth-filter-btn'
              data-filter='all'
            >
              All
            </button>
            <button
              type='button'
              class='btn btn-ghost auth-filter-btn'
              data-filter='authenticated'
            >
              Authenticated
            </button>
            <button
              type='button'
              class='btn btn-ghost auth-filter-btn'
              data-filter='unauthenticated'
            >
              Unauthenticated
            </button>
          </div>
        </div>
      </div>

      {/* Connections table */}
      <div class='chart-container' style='padding:0;overflow:hidden'>
        <table class='table' id='connections-table'>
          <thead>
            <tr>
              <th style='width:40px'>
                <input type='checkbox' id='select-all' title='Select all' />
              </th>
              <th>ID</th>
              <th>Client IP</th>
              <th>Pubkey</th>
              <th>Auth</th>
              <th>Connected</th>
              <th style='width:100px'>Action</th>
            </tr>
          </thead>
          <tbody id='connections-tbody'>
            <tr>
              <td
                colspan={7}
                style='text-align:center;padding:32px;color:var(--color-text-muted)'
              >
                Loading…
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <script src='/admin/static/utils.js'></script>
      <script src='/admin/static/connections.js' type='module'></script>
    </Layout>
  );
}
