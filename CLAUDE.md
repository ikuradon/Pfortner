# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pförtner is a modular Nostr proxy library written in TypeScript for the Deno runtime. It sits between Nostr clients and upstream relays, allowing relay administrators to apply policies that rewrite, filter, or inject data in both directions. The name means "doorman" in German.

## Commands

```bash
# Development server (with file watching)
deno task dev

# Production server
deno task serve

# Run with YAML config
deno task serve:config

# Run all tests
deno task test

# Run load benchmark
deno task bench

# Run a single test file
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/policies/AcceptPolicy.test.ts

# Run tests matching a pattern
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv --filter "eventSifterPolicy" src/

# Format code
deno fmt

# Lint code
deno lint

# Docker
docker compose up
```

## Code Style

Configured in `deno.json`: 2-space indent, 120-char line width, semicolons required, single quotes, no tabs. The `no-explicit-any` lint rule is excluded.

## Coding Patterns

- npm packages (ajv, maxmind): use `const Mod = (imported as any).default ?? imported` for CJS/ESM compat
- RateLimitPolicy/SpamFilterPolicy have module-level global state (`sharedCounters`, `seenEventIds`) — call `destroy()` between tests to avoid state leak
- `initialize()` methods: do NOT use `async` if only returning `Promise.resolve()` — lint `require-await` will fail
- Client-side JS (`admin/static/*.js`): use `createElement`/`textContent` only, never `innerHTML` (XSS prevention)
- Static file paths: validate with `resolve()` + `startsWith()`, not string `..` check (path traversal)
- Shared client utilities in `admin/static/utils.js` (formatUptime, safeFetch) — loaded via `<script>` tag
- `admin/main.ts` is the Fresh app composition root; static serving, security helpers, page routes, and API routes live in `admin/static_files.ts`, `admin/security.ts`, `admin/page_routes.ts`, and `admin/api_routes.ts`

## Architecture

### Core: `src/pfortner.ts`

`pfortnerInit(upstreamAddress, options?)` is the single entry point. It creates a per-connection proxy instance that:

1. Upgrades an HTTP request to a client-side WebSocket
2. Opens an upstream `WebSocketStream` to the relay
3. Routes messages through registered policy pipelines in each direction
4. Handles NIP-42 authentication (AUTH messages are terminated at the proxy, never forwarded)
5. Manages idle timeouts and connection lifecycle

Returns an object with: `createSession`, `registerClientPipeline`, `registerServerPipeline`, `on`/`off` event listeners, `connectionInfo`, and direct message senders.

Core session internals are split under `src/session/`: `auth.ts` verifies NIP-42 AUTH, `events.ts` owns the listener registry, `pipeline-runner.ts` executes policy tuples, `client-session.ts` parses client payloads, and `upstream.ts` contains upstream socket helpers. Keep these modules internal unless intentionally expanding the public API.

### Policy System

A `Policy` is a function: `(message, connectionInfo, options?) => OutputMessage | Promise<OutputMessage>`

`OutputMessage.action` determines flow:

- `'accept'` — forward the message and stop the pipeline
- `'reject'` — drop the message (optional `response` string sent to client) and stop
- `'next'` — pass to the next policy in the chain

Policies are registered as arrays via `registerClientPipeline` (client→relay) and `registerServerPipeline` (relay→client). Each entry can be a bare policy function or a `[policy, options]` tuple for parameterized policies.

### Plugin System (`src/plugins/`)

`PolicyPlugin` interface with `initialize(config, infra) → PolicyFactory`. Factory is called per-connection to produce stateful `Policy` functions. 12 builtin plugins registered in `registry.ts`. External plugins loaded via dynamic `import()`.

`extractEvent(message)` handles both client (`[EVENT, event]`) and server (`[EVENT, subId, event]`) direction EVENT messages.

### Built-in Policies (`src/policies/`)

- **AcceptPolicy** — pass-through
- **EventSifterPolicy** — filters by source type (IP4/IP6/Stream)
- **KindFilterPolicy** — deny/allow by event kind + require_auth_for
- **WriteGuardPolicy** — auth required, allowed_kinds, read_only_mode
- **ProtectedEventPolicy** — NIP-70 protected events
- **RateLimitPolicy** — sliding window (connection/ip/pubkey scope, redis/memory backend)
- **SpamFilterPolicy** — PoW, content length, duplicate detection
- **ContentFilterPolicy** — blocked words/patterns, external API
- **PubkeyAclPolicy** — allowlist/blocklist, external list, WoT
- **IpFilterPolicy** — IP/CIDR blocklist, Tor blocking, GeoIP
- **WhenPlugin / MatchPlugin** — conditional pipeline branching (nestable, AND/OR/NOT)
- **RoutePlugin** — dynamic routing to alternative upstream relays (NIP-50)

### Config System (`src/config/`)

YAML config loader (`loader.ts`) with env var expansion (`${VAR}`), ajv schema validation, and hot reload via `ConfigManager`. `starter.ts` is the request handler composition root. Plugin validation and recursive sub-pipeline resolution live in `pipeline-resolver.ts`; request-time drain, connection pressure, client IP, and runtime blocklist checks live in `runtime-guards.ts`; `managed-connection-adapter.ts` adapts `pfortnerInit()` instances for operational tracking.

### Infrastructure (`src/infra/`)

- **logger.ts** — structured JSON/text logger
- **prometheus.ts** — Prometheus metrics with labels
- **redis.ts** — Redis connector (`npm:redis`)
- **kv.ts** — Deno KV adapter (implements RedisClient interface)
- **geoip.ts** — MaxMind MMDB lookup
- **throughput-tracker.ts** — ring buffer for time-series data

### Operational (`src/connections/`, `src/shutdown/`)

- **ConnectionManager** — global/per-IP limits, auth-based pressure control
- **ShutdownManager** — graceful shutdown (SIGTERM/SIGINT, drain, force close)
- **UpstreamProbe** — HTTP-based latency monitoring
- **ManagedConnection** — wraps pfortnerInit return with close/notice/auth methods

### Dynamic Routing (`src/upstream/`)

**UpstreamPool** manages shared WebSocket connections to alternative relays. Subscription ID multiplexing via `{clientId}:subId` prefix (split on first `:`).

### Admin UI (`admin/`)

Fresh 2.x + Preact serves `/admin` on the main port. Login remains SSR; authenticated pages return the shared `AdminAppShell`, and the browser SPA router renders Dashboard, Connections, Pipelines, Playground, Metrics, Blocklist, Config, and Logs. `admin/static/app.js` only boots the SPA and propagates asset versions; routing is in `admin/static/router.js`; DOM templates are in `admin/static/page_templates.js`; shared DOM helpers are in `admin/static/dom.js`. Admin API read models and mutations are split across `src/admin/health.ts`, `connections.ts`, `logs.ts`, `config_view.ts`, `throughput.ts`, and `pipeline_simulator.ts`; `src/admin/service.ts` is a compatibility barrel.

### Event System

The `on()`/`off()` methods subscribe to lifecycle events: `authSuccess`, `authFailed`, `client*` (Connect/Disconnect/Error/Msg/Auth/Event/Request/Close), `server*` (Connect/Disconnect/Error/Msg/Event/Ok/Eose/Closed/Notice).

### Public API (`mod.ts`)

Exports the intended public surface: core API, config loading/request handling, plugin types and registry, infra helpers, policy plugins, condition helpers, upstream routing, operational managers, and admin handler/state types. Internal session, admin routing, and bootstrap helper modules are not exported directly.

### Example Server (`scripts/serve.ts`)

Supports two modes: legacy env-var mode and YAML config mode. Config mode enables plugin system, admin UI, metrics, connection management, and graceful shutdown.

## Environment Variables

Legacy env-var mode (`.env` from `.env.sample`):

- `APP_PORT` — server listen port
- `UPSTREAM_RELAY` — WebSocket URL of upstream relay (e.g. `wss://relay.example.com`)
- `UPSTREAM_RAW_URL` — HTTP URL of upstream relay (for relay info endpoint)
- `X_FORWARDED_FOR` — whether to forward client IP

YAML config mode (preferred): copy `pfortner.sample.yaml` to `pfortner.yaml`. See spec docs in `docs/superpowers/specs/` for full schema. Run with `deno task serve:config`.

## Documentation

Current architecture is summarized in `docs/current-architecture.md`. Design specs and implementation plans are in `docs/superpowers/` (gitignored). Historical goal plans under `docs/*-goal-plan.md` record decisions and migration context.
