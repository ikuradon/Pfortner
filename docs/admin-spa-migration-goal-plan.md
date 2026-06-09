# Admin UI SPA 化 最終目標計画

## 最終目標

admin UI の authenticated pages を、Fresh の page component を毎回 SSR して遷移する構造から、共通の SPA shell と client router で画面を切り替える構造へ移行する。

到達状態は次の通り。

- `/admin` は `/admin/` に redirect する。
- `/admin/`, `/admin/connections`, `/admin/pipelines`, `/admin/playground`, `/admin/metrics`, `/admin/blacklist`, `/admin/config`, `/admin/logs` は同じ `AdminAppShell` HTML を返す。
- 初期 HTML は sidebar、theme toggle mount、`main#admin-app`、`client.js`、`utils.js`、`app.js` だけを持つ。
- `admin/static/app.js` が History API で route を解決し、DOM template を生成し、page module の `init*Page()` を dynamic import で呼ぶ。
- page 変更時には前 page の cleanup を呼び、polling timer と SSE connection を止める。
- login/logout、admin API、static file serving、cookie/Bearer auth、CSRF 境界は server 側に残す。

## 目標設定について

このスレッドには完了済み goal が残っており、goal tool は新規 goal 作成を拒否した。そのため、実行上の目標はこの計画ファイルを canonical source として扱う。

詳細な agent 実行計画は `docs/superpowers/plans/2026-06-09-admin-spa-shell.md` にも保存した。ただし `docs/superpowers/` は `.gitignore` 対象なので、通常の repo 差分として残す計画はこのファイルである。

## アーキテクチャ

### Server

`admin/main.ts` は次の境界を維持する。

- `/admin/login`: SSR login page。
- `/admin/logout`: cookie clear + login redirect。
- `/admin/static/*`: static file serving。
- `/admin/api/*`: JSON/SSE/mutation API。
- authenticated page routes: `AdminAppShell` を返す。

authenticated page route では dashboard health data などを SSR payload として組み立てない。各 page の初期 data は browser 側 module が既存 API から取得する。

### Shell

`admin/routes/app.tsx` は次を担当する。

- sidebar を server render する。
- request path に基づき initial active nav を付ける。
- `main#admin-app` を SPA の mount point にする。
- `styles.css`, `client.js`, `utils.js`, `app.js` を version query 付きで読み込む。
- version query は、SPA 移行前に browser が cache した page module を避けるために使う。

Shell は login page では使わない。

### Client Router

`admin/static/app.js` は次を担当する。

- `globalThis.__PFORTNER_SPA__ = true` を設定する。
- `/admin/*` の既知 page route table を持つ。
- sidebar link click を intercept し、`history.pushState()` で遷移する。
- Back/Forward は `popstate` で再描画する。
- `document.title` と sidebar active class を route ごとに更新する。
- DOM template を `innerHTML` なしで生成する。
- page module を dynamic import し、`init*Page()` を呼ぶ。
- `app.js` 自身の version query を page module import にも引き継ぐ。
- route change 前に前 page の cleanup を呼ぶ。
- import/init failure は `#admin-app` 内に error state として表示する。

## Page Module Contract

各 `admin/static/*.js` は直接 SSR page からも、SPA router からも使える。

- Dashboard: `initDashboardPage()`
- Connections: `initConnectionsPage()`
- Pipelines: `initPipelinesPage()`
- Playground: `initPlaygroundPage()`
- Metrics: `initMetricsPage()`
- Blacklist: `initBlacklistPage()`
- Config: `initConfigPage()`
- Logs: `initLogsPage()`

各 module は以下の guard を持つ。

```js
if (typeof document !== 'undefined' && !globalThis.__PFORTNER_SPA__) {
  document.addEventListener('DOMContentLoaded', initPageFunction);
}
```

SPA router から呼ばれる場合は guard により自動初期化せず、`app.js` が明示的に init する。

## Lifecycle 要件

- Connections は `createPoller()` で polling を開始し、cleanup で停止する。
- Metrics は `createPoller()` で polling を開始し、cleanup で停止する。
- Dashboard は `createPoller()` で health/throughput polling を開始し、cleanup で停止する。
- Logs は `createEventStream()` で SSE を開き、cleanup で close する。
- Pipelines と Playground は module state を init 時に初期化し直す。

## DOM Contract

SPA template は各 page module が参照する id/class を必ず作る。

- Dashboard: `#stats-cards`, `.chart-container .chart-title`, `.progress-bar`, `#throughput-chart-body`
- Connections: `#btn-refresh`, `#btn-disconnect-selected`, `#summary-total`, `#summary-authed`, `#summary-unauthed`, `#search-input`, `.auth-filter-btn`, `#select-all`, `#connections-tbody`
- Pipelines: `#btn-refresh-pipelines`, `#btn-apply-pipeline`, `#pipeline-status`, `.pipeline-tab`, `#tree-panel-title`, `#pipeline-tree-container`, `#add-policy-select`, `#btn-add-policy`, `#yaml-preview`
- Playground: `.dir-tab`, `.preset-btn`, `#message-input`, `#ctx-authenticated`, `#ctx-pubkey`, `#ctx-ip`, `#btn-run`, `#result-panel`
- Metrics: `.time-range-btn`, `#btn-refresh-metrics`, `#throughput-chart-body`, `#policy-decisions-body`, `#connection-chart-body`, `#raw-metrics-toggle`, `#raw-metrics-chevron`, `#raw-metrics-content`, `#raw-metrics-search`, `#btn-copy-metrics`, `#raw-metrics-pre`
- Blacklist: `#btn-refresh`, `#ip-input`, `#btn-add-ip`, `#ip-list-container`, `#ip-tbody`, `#pubkey-input`, `#btn-add-pubkey`, `#pubkey-list-container`, `#pubkey-tbody`
- Config: `#btn-refresh-config`, `#btn-reload-config`, `#config-status`, `#config-json`
- Logs: `#btn-refresh-logs`, `#log-level-display`, `#log-stream-status`, `#btn-pause-logs`, `#btn-clear-logs`, `#log-count-display`, `#log-viewer`, `#log-empty-state`, `#runtime-info-tbody`

## 実行手順

1. SPA shell route の regression test を追加し、SSR page route では失敗することを確認する。
2. `admin/main.ts` の authenticated page routes を `AdminAppShell` render に統合する。
3. `admin/routes/app.tsx` を shell として追加する。
4. `admin/static/app.js` に route table、DOM template、History API navigation、dynamic import、cleanup 管理を追加する。
5. `pipelines` と `playground` の inline route CSS を `admin/static/styles.css` に移す。
6. page module の `init*Page()` export と SPA guard を揃える。
7. module state が残る page は init 時に初期化し直す。
8. format、lint、targeted tests、full tests、HTTP smoke を実行する。

## 検証項目

- `deno fmt --config deno.json ...`
- `deno lint --config deno.json ...`
- `deno check admin/static/app.js`
- `deno test --allow-env --allow-read --allow-write admin/main.test.ts src/admin/server.test.ts src/admin/service.test.ts src/connections/manager.test.ts src/admin/pipelines-static.test.ts`
- `deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/ admin/main.test.ts`
- HTTP smoke:
  - `GET /admin` returns `302 Location: /admin/`
  - `GET /admin/connections` returns shell HTML with `id="admin-app"` and `/admin/static/app.js`
  - shell HTML does not include route-specific `/admin/static/connections.js`
  - `GET /admin/static/app.js` returns router JavaScript
  - `GET /admin/api/connections` returns JSON

## 完了条件

- `/admin/*` authenticated pages は SPA shell を返す。
- sidebar navigation は known admin pages で client-side 遷移する。
- API/auth/static/login/logout の server behavior は維持される。
- page change cleanup により polling/SSE が残り続けない。
- Connections の IP は DTO の `ip` から表示でき、legacy field にも fallback できる。
- 上記検証項目が fresh に通っている。
