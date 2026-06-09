# Terminology Modernization Goal Plan

作成日: 2026-06-09

## 最終目標

Admin UI と runtime policy のリスト制御用語を、現在の公開面で問題になりやすい旧 deny-list / permit-list 表現から `blocklist` / `allowlist` へ完全に置き換える。ユーザー指定により後方互換性は破棄するため、旧 URL、旧 API path、旧 config key、旧 mode 値、旧 runtime option は alias として残さない。

## スコープ

- Admin UI のページ名、ナビゲーション、SPA route、静的 JS initializer を `Blocklist` / `blocklist` に改名する。
- Admin UI API を `/admin/api/blocklist` 配下に移し、旧 deny-list API は削除する。
- 独立 admin handler の API を `/blocklist/pubkey` と `/blocklist/ip` に移し、旧 deny-list API は削除する。
- `AdminState` / `AdminServiceState` の状態名を `blocklist` に改名する。
- `RequestHandlerHooks` と `pfortnerInit` の runtime option を `blocklist` / `pubkeyBlocklist` に改名する。
- `pubkey-acl` policy の mode を `allowlist` / `blocklist` に改名し、schema と実行ロジックを新語に合わせる。
- `ip-filter` policy の config key を `blocklist` に改名し、schema と実行ロジックを新語に合わせる。
- `content-filter` policy の config key を `blocked_words` / `blocked_patterns` に改名し、schema と実行ロジックを新語に合わせる。
- pipeline editor のデフォルト config と YAML preview 期待値を新 schema に合わせる。
- 文書、テスト名、コメント、ログ文言の残存用語を新語へ整理する。

## 非スコープ

- 旧語を受け付ける migration layer、redirect、API alias、config alias は作らない。
- 既存の保存済み設定ファイルを自動変換する CLI は追加しない。
- 旧語を含む外部プロトコルや第三者由来の語までは変更しない。ただし現時点の対象コードには該当なし。

## 期待する挙動

- `/admin/blocklist` は認証済み Admin SPA shell を返す。
- 旧 deny-list page URL は route 未定義として扱われる。
- `/admin/api/blocklist` は `{ pubkeys, ips }` を返し、POST/DELETE で各 Set を更新する。
- 旧 deny-list API URL は route 未定義として扱われる。
- `pubkey-acl` は `mode: "allowlist"` で未登録 pubkey を拒否し、`mode: "blocklist"` で登録 pubkey を拒否する。
- `ip-filter` は `config.blocklist.ips` と `config.blocklist.cidrs` を参照して拒否判定する。
- `content-filter` は `config.blocked_words` と `config.blocked_patterns` を参照して拒否判定する。
- `pfortnerInit(..., { pubkeyBlocklist })` は AUTH、client EVENT、server relay の各段階で対象 pubkey を遮断する。
- `RequestHandlerHooks.blocklist` は runtime IP と pubkey の遮断リストとして利用される。

## 実装ステップ

1. 新語を期待する admin/policy/runtime テストへ更新し、旧語前提のテストが失敗する状態を確認する。
2. Admin state 型と state 作成箇所を `blocklist` に改名する。
3. Admin UI route、SPA route table、静的 page module、Sidebar、page component を `blocklist` に改名する。
4. Admin API handler を `/blocklist` に移す。
5. `pubkey-acl`、`ip-filter`、`content-filter` の schema、型、ロジックを新語へ改名する。
6. runtime hook と `pfortnerInit` option を新語へ改名する。
7. pipeline editor とドキュメントの残存用語を整理する。
8. `rg` で旧語の残存を確認し、意図せず残ったものを削除する。
9. `deno fmt --check`、`deno lint`、targeted tests、full tests を実行する。
10. 検証後に atomic commit を作成する。

## 検証対象

- `deno fmt --check`
- `deno lint`
- `deno check admin/static/app.js admin/static/app.test.ts`
- admin UI/API 関連テスト
- admin service/pipeline editor 関連テスト
- policy 関連テスト
- pfortner runtime 関連テスト
- full `deno test`
- 必要に応じた HTTP smoke: `/admin/blocklist` と `/admin/api/blocklist`
