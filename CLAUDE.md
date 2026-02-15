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

# Run all tests
deno test --allow-env

# Run a single test file
deno test --allow-env src/policies/AcceptPolicy.test.ts

# Run tests matching a pattern
deno test --allow-env --filter "eventSifterPolicy"

# Format code
deno fmt

# Lint code
deno lint

# Docker
docker compose up
```

## Code Style

Configured in `deno.json`: 2-space indent, 120-char line width, semicolons required, single quotes, no tabs. The `no-explicit-any` lint rule is excluded.

## Architecture

### Core: `src/pfortner.ts`

`pfortnerInit(upstreamAddress, options?)` is the single entry point. It creates a per-connection proxy instance that:

1. Upgrades an HTTP request to a client-side WebSocket
2. Opens an upstream `WebSocketStream` to the relay
3. Routes messages through registered policy pipelines in each direction
4. Handles NIP-42 authentication (AUTH messages are terminated at the proxy, never forwarded)
5. Manages idle timeouts and connection lifecycle

Returns an object with: `createSession`, `registerClientPipeline`, `registerServerPipeline`, `on`/`off` event listeners, `connectionInfo`, and direct message senders.

### Policy System

A `Policy` is a function: `(message, connectionInfo, options?) => OutputMessage | Promise<OutputMessage>`

`OutputMessage.action` determines flow:

- `'accept'` — forward the message and stop the pipeline
- `'reject'` — drop the message (optional `response` string sent to client) and stop
- `'next'` — pass to the next policy in the chain

Policies are registered as arrays via `registerClientPipeline` (client→relay) and `registerServerPipeline` (relay→client). Each entry can be a bare policy function or a `[policy, options]` tuple for parameterized policies.

### Built-in Policies (`src/policies/`)

- **AcceptPolicy** — trivial pass-through; returns `accept` for all messages
- **EventSifterPolicy** — filters relay→client EVENT messages by kind, with allow/deny lists. Non-EVENT messages pass through

### Event System

The `on()`/`off()` methods subscribe to lifecycle events: `authSuccess`, `authFailed`, `client*` (Connect/Disconnect/Error/Msg/Auth/Event/Request/Close), `server*` (Connect/Disconnect/Error/Msg/Event/Ok/Eose/Closed/Notice).

### Public API (`mod.ts`)

Exports `pfortnerInit`, the `Policy` type, `acceptPolicy`, and `eventSifterPolicy`.

### Example Server (`scripts/serve.ts`)

Demonstrates NIP-42 auth enforcement for DM (kind 4) access, including message stashing before auth completes and re-sending after successful auth.

## Environment Variables

Defined in `.env` (copy from `.env.sample`):

- `APP_PORT` — server listen port
- `UPSTREAM_RELAY` — WebSocket URL of upstream relay (e.g. `wss://relay.example.com`)
- `UPSTREAM_RAW_URL` — HTTP URL of upstream relay (for relay info endpoint)
- `X_FORWARDED_FOR` — whether to forward client IP
