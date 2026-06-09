# Admin Logs SSE 最終目標計画

## 最終目標

admin UI の `Logs` ページを、現在の placeholder から「稼働中プロセスの直近ログを確認でき、SSE で新規ログを追尾できる実ログビューア」にする。

この実装は永続ログ基盤ではなく、現在の Pförtner process が出力した最近のログを admin UI から観測するための軽量な運用機能として扱う。

## 完了条件

- `infra.logger` が既存どおり stdout へログを出しつつ、同じログ行を in-memory buffer に保存する。
- admin state から直近ログを JSON API で取得できる。
- admin state から SSE stream で新規ログを購読できる。
- `/admin/logs` の `Log Viewer` が placeholder ではなくログ行を表示する。
- UI は initial load、streaming、pause/resume、clear、manual refresh、connection status を持つ。
- SSE が利用できない状態でも manual refresh で直近ログを表示できる。
- 既存 admin auth middleware の cookie/Bearer 認証を維持する。
- test で ring buffer、legacy admin API、Fresh admin API の基本動作を確認する。
- 既存の logger output format、log level filtering、admin health/config API の動作を壊さない。

## 非目標

- ログの永続保存。
- ファイルログの tail。
- 過去ログ検索、全文検索、ページング。
- 複数 process 間のログ集約。
- WebSocket 実装。
- admin UI から log level を動的変更する機能。

## 実装方針

### 1. In-memory log buffer

`src/infra/log-buffer.ts` を追加する。

保持する情報は parsed object ではなく、logger が生成した 1 行の文字列を基準にする。理由は、現行 logger が `json` と `text` の 2 format を持っており、UI はどちらでも表示できる必要があるため。

buffer entry は以下を持つ。

- `id`: process 内で単調増加する number。
- `line`: logger sink に渡された文字列。
- `received_at`: buffer が受け取った ISO timestamp。

API は以下を持つ。

- `push(line: string): LogEntry`
- `list(limit?: number): LogEntry[]`
- `subscribe(callback: (entry: LogEntry) => void): () => void`
- `size(): number`
- `subscriberCount(): number`

最大件数は constructor で指定可能にし、default は `1000` とする。limit は負値や異常値に強くし、API 側では `1..1000` に丸める。

### 2. Logger と process output の tee

`createLogger` 自体の public API は変えない。`buildInfraContext` の既存 `logSink` を使い、`scripts/serve.ts` で tee sink を構成する。

config mode では以下の流れにする。

1. `const logBuffer = new LogBuffer(1000)` を作る。
2. `buildInfraContext({ ..., logSink })` に sink を渡す。
3. sink は `console.log(line)` と `logBuffer.push(line)` を呼ぶ。
4. `adminState.logBuffer = logBuffer` にする。

これにより既存 stdout 出力を維持し、admin UI の観測だけを追加する。

legacy env-var mode は admin UI を持たないため対象外にする。

### 3. Admin service/API

`AdminServiceState` と `AdminState` に optional `logBuffer` を追加する。

service に以下を追加する。

- `getLogs(state, limit)`
  - `logBuffer` がなければ空配列を返す。
  - response は `{ logs, total, subscribers }`。
- `createLogStreamResponse(state, options)`
  - Fresh route と legacy admin route の両方から使える `Response` を返す。
  - `logBuffer` がなければ `503` JSON を返す。

Fresh admin API に以下を追加する。

- `GET /admin/api/logs?limit=200`
- `GET /admin/api/logs/stream?replay=100`

legacy admin API に以下を追加する。

- `GET /logs?limit=200`
- `GET /logs/stream?replay=100`

SSE response は以下の header を設定する。

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

SSE event は以下にする。

- `event: log`
- `data: {"id":1,"line":"...","received_at":"..."}`

接続直後は `replay` 件の直近ログを流す。heartbeat は `event: heartbeat` を一定間隔で流す。request abort 時は unsubscribe し、interval を止める。

### 4. Logs UI

`admin/routes/logs.tsx` の placeholder を実ログビューアに置き換える。

画面要素は以下。

- `Refresh` button: `/admin/api/logs` を再取得。
- `Pause` button: 表示更新を止める。SSE 接続は維持してもよいが、pending entries を溜めすぎないため pause 中は受信 entry を画面に追加しない。
- `Clear` button: UI 上の表示だけ消す。server buffer は消さない。
- `Connection Status`: `connecting` / `streaming` / `paused` / `fallback` / `disconnected`。
- `Log Viewer`: monospace の scrollable list。

`admin/static/logs.js` は以下を行う。

- `fetchInfo()` で既存 runtime info を更新する。
- `fetchLogs()` で initial/fallback load を行う。
- `connectStream()` で `EventSource('/admin/api/logs/stream?replay=100')` に接続する。
- `event: log` で新規行を追加する。
- `event: heartbeat` で接続状態を維持する。
- 最大表示件数は client 側でも `500` 件程度に制限する。
- JSON log 行は parse できれば level/timestamp/message を読み、level class を付ける。parse できなければ raw text として表示する。
- すべて DOM 生成は `createElement` と `textContent` を使い、`innerHTML` は使わない。

### 5. CSS

`admin/static/styles.css` に log viewer 用の控えめな style を追加する。

- `.log-toolbar`
- `.log-status`
- `.log-viewer`
- `.log-row`
- `.log-row-level`
- `.log-row-time`
- `.log-row-message`
- level ごとの色 class

既存 admin UI の card/table/button style を尊重し、装飾を増やしすぎない。

### 6. Test

追加・更新する test は以下。

- `src/infra/log-buffer.test.ts`
  - max entries を超えたら古い entry が落ちる。
  - id が増加する。
  - subscriber に新規 entry が届く。
  - unsubscribe 後は届かない。

- `src/admin/service.test.ts`
  - `getLogs` が buffer あり/なしで正しく返す。

- `src/admin/server.test.ts`
  - legacy `GET /logs` が Bearer auth 配下で JSON を返す。
  - legacy `GET /logs/stream` が `text/event-stream` を返す。

- `admin/main.test.ts`
  - Fresh `GET /admin/api/logs` が Bearer auth 配下で JSON を返す。
  - Fresh `GET /admin/api/logs/stream` が `text/event-stream` を返す。

実行する検証は以下。

- `deno fmt --config deno.json` 対象ファイル。
- `deno test --allow-env src/infra/log-buffer.test.ts src/admin/service.test.ts src/admin/server.test.ts admin/main.test.ts`

必要に応じて `--allow-read` など、既存テストが要求する権限を付ける。

## リスクと対策

- SSE connection が開き続けるため resource leak の可能性がある。
  - `req.signal` abort で unsubscribe と heartbeat interval cleanup を必ず行う。

- ログが大量発生すると UI が重くなる。
  - server buffer と client 表示件数の両方に上限を持たせる。

- text log と JSON log の混在で UI 表示が壊れる。
  - JSON parse は best effort にし、失敗時は raw line を表示する。

- admin auth の bypass が起きる。
  - 既存 middleware/handler の認証後 route として実装し、個別 bypass を作らない。

- logger output が二重に出る。
  - `createLogger` default sink は変えず、config mode だけ tee sink を渡す。

## 実行順

1. `LogBuffer` と test を追加する。
2. admin service/state に log buffer API を追加する。
3. Fresh/legacy admin route を追加する。
4. `scripts/serve.ts` に tee sink と `adminState.logBuffer` を追加する。
5. `/admin/logs` markup と static JS を実ログビューアへ更新する。
6. CSS を追加する。
7. fmt/test を実行する。
8. 失敗があれば修正し、作業ツリー差分を確認する。
