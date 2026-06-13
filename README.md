# Pförtner

**Pförtner** (German for "doorman") is a modular Nostr proxy library for the Deno runtime. It sits between Nostr clients and upstream relays, enabling relay administrators to apply policies that filter, rewrite, or inject data in both directions.

## Features

### Policy System

Create custom policies to control message flow between clients and relays. Policies can:

- Filter messages by type, content, or metadata
- Rewrite or modify messages on-the-fly
- Inject additional data into the stream
- Accept, reject, or pass messages to the next policy in the pipeline

### NIP-42 Authentication

Built-in support for NIP-42 AUTH handling:

- AUTH messages are terminated at the proxy level (never forwarded upstream)
- Track authenticated client public keys
- Stash and replay messages after successful authentication
- Flexible authorization policies based on authenticated identity

### Event System

Subscribe to lifecycle events for fine-grained control:

- Connection events (`clientConnect`, `serverConnect`, etc.)
- Message events (`clientMsg`, `serverMsg`, etc.)
- Authentication events (`authSuccess`, `authFailed`)
- Protocol-specific events (`clientEvent`, `serverEvent`, `serverOk`, etc.)

## Installation

Pförtner is a Deno library. No installation is required—simply import it directly:

```typescript
import {
  acceptPolicy,
  eventSifterPolicy,
  pfortnerInit,
} from 'https://raw.githubusercontent.com/ikuradon/Pfortner/main/mod.ts';
```

## Quick Start

### Basic Setup

1. Clone the repository or create a new Deno project
2. Choose a writable data directory for local development:

```bash
mkdir -p .data
```

3. Run the server:

```bash
PFORTNER_DATA_DIR=.data deno task serve
```

The server starts from `src/server/main.ts` on `PFORTNER_LISTEN_PORT` (default: 3000). If
`config.yaml` is missing from the data directory, the Admin UI at `/admin` starts in setup mode and
persists the generated config, admin token, and runtime state under that data directory.

### Server Runtime

`deno task serve` uses the dataDir/Admin-first runtime. Set `PFORTNER_DATA_DIR` or pass
`--data-dir <path>` to choose where bootstrap config, admin token, and local state are stored.

## Environment Variables

Configure the runtime with these environment variables:

| Variable                    | Required | Description                                     | Example    |
| --------------------------- | -------- | ----------------------------------------------- | ---------- |
| `PFORTNER_DATA_DIR`         | No       | Data directory for config, token, KV, and state | `/data`    |
| `PFORTNER_LISTEN_PORT`      | No       | Server listen port                              | `3000`     |
| `PFORTNER_LISTEN_ADDR`      | No       | Server listen address                           | `[::]`     |
| `PFORTNER_ADMIN_ENABLED`    | No       | Enable Admin UI setup/runtime routes            | `true`     |
| `PFORTNER_ADMIN_TOKEN`      | No       | Admin token override                            | `secret`   |
| `PFORTNER_ADMIN_TOKEN_FILE` | No       | Admin token file path                           | `/token`   |
| `PFORTNER_LOG_LEVEL`        | No       | Runtime log level                               | `info`     |
| `PFORTNER_LOG_FORMAT`       | No       | Runtime log format                              | `text`     |
| `PFORTNER_TRUST_PROXY`      | No       | Trust proxy headers for client IP handling      | `false`    |
| `PFORTNER_REDIS_URL`        | No       | Redis URL for shared policy state               | `redis://` |
| `PFORTNER_REDIS_URL_FILE`   | No       | File containing Redis URL                       | `/secret`  |
| `PFORTNER_REDIS_KEY_PREFIX` | No       | Redis key prefix                                | `pfortner` |

## Creating Custom Policies

A policy is a function that examines a message and decides what to do with it:

```typescript
import { type Policy } from 'https://raw.githubusercontent.com/ikuradon/Pfortner/main/mod.ts';

const myPolicy: Policy = (message, connectionInfo, options?) => {
  // Examine the message
  const [messageType, ...rest] = message;

  // Make a decision
  if (shouldAccept(message)) {
    return { message, action: 'accept' }; // Forward and stop pipeline
  } else if (shouldReject(message)) {
    return {
      message,
      action: 'reject',
      response: '["NOTICE","Access denied"]', // Optional response to client
    };
  } else {
    return { message, action: 'next' }; // Pass to next policy
  }
};
```

### Policy Actions

- `'accept'` — Forward the message to its destination and stop the pipeline
- `'reject'` — Drop the message (optionally send a response to the client) and stop the pipeline
- `'next'` — Pass the message to the next policy in the chain

### Registering Policies

```typescript
const pfortner = pfortnerInit(UPSTREAM_RELAY, options);

// Client → Relay pipeline
pfortner.registerClientPipeline([
  myClientPolicy,
  [parameterizedPolicy, { option1: 'value' }],
  acceptPolicy,
]);

// Relay → Client pipeline
pfortner.registerServerPipeline([
  myServerPolicy,
  acceptPolicy,
]);
```

### Built-in Policies

- **acceptPolicy** — Pass-through policy that accepts all messages
- **eventSifterPolicy** — Filter client→relay and relay→client EVENT messages through EventSifter-compatible sub-policies

## Docker Usage

Build the Docker image:

```bash
docker build -t pfortner .
```

Run the container:

```bash
docker run -p 3000:3000 \
  -v pfortner-data:/data \
  pfortner
```

Or use Docker Compose:

```yaml
services:
  pfortner:
    build: .
    ports:
      - '3000:3000'
    volumes:
      - pfortner-data:/data

volumes:
  pfortner-data:
```

## API Reference

### `pfortnerInit(upstreamAddress, options?)`

Creates a proxy instance.

**Parameters:**

- `upstreamAddress` (string): WebSocket URL of the upstream relay
- `options` (object, optional):
  - `clientIp` (string): Client IP address
  - `sendAuthOnConnect` (boolean): Send AUTH challenge on connection
  - `upstreamRawAddress` (string): HTTP URL for relay info endpoint
  - `allowedAuthTimeDuration` (number): Maximum allowed time difference for AUTH events in the past (seconds, default: 600)
  - `allowedAuthFutureTimeDuration` (number): Maximum allowed time difference for AUTH events in the future (seconds, default: 60)
  - `maxAuthAttempts` (number): Maximum number of AUTH attempts per connection (default: 10)
  - `idleTimeout` (number): Idle timeout duration in seconds (default: 600)

**Returns:** An object with:

- `createSession(req)` — Upgrade HTTP request to WebSocket session
- `registerClientPipeline(policies)` — Register client→relay policies
- `registerServerPipeline(policies)` — Register relay→client policies
- `on(event, handler)` — Subscribe to lifecycle events
- `off(event, handler)` — Unsubscribe from events
- `connectionInfo` — Current connection state (auth status, pubkey, etc.)
- `sendMessageToClient(message)` — Send a message directly to the client
- `sendMessageToServer(message)` — Send a message directly to the upstream relay

Each `pfortnerInit()` result is a per-connection proxy instance. Call `createSession(req)` only once for that
instance; create a new `pfortnerInit()` instance for each incoming WebSocket client.

### Event Types

Subscribe to these events using `pfortner.on(event, handler)`:

**Connection Events:**

- `clientConnect`, `clientDisconnect`, `clientError`
- `serverConnect`, `serverDisconnect`, `serverError`

**Authentication Events:**

- `authSuccess(event)` — Client successfully authenticated
- `authFailed()` — Client authentication failed

**Message Events:**

- `clientMsg(message)` — Any message from client
- `serverMsg(message)` — Any message from server
- `clientEvent(event)` — EVENT message from client
- `serverEvent(subscriptionId, event)` — EVENT message from server
- `clientRequest(subscriptionId, filters)` — REQ message from client
- `clientClose(subscriptionId)` — CLOSE message from client
- `serverOk(eventId, accepted, message)` — OK message from server
- `serverEose(subscriptionId)` — EOSE message from server
- `serverClosed(subscriptionId, message)` — CLOSED message from server
- `serverNotice(message)` — NOTICE message from server

## Development

```bash
# Development server with file watching
deno task dev

# Run tests
deno task test

# Format code
deno fmt

# Lint code
deno lint
```

## License

Pförtner is licensed under the MIT License. See [LICENSE](LICENSE) for details.
