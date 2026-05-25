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
2. Copy `.env.sample` to `.env` and configure your environment variables:

```bash
cp .env.sample .env
```

3. Edit `.env` with your settings (see [Environment Variables](#environment-variables))

4. Run the example server:

```bash
deno task serve
```

The server will start on the port specified in `APP_PORT` (default: 3000).

### Example Server

A complete example is available in `scripts/serve.ts`, which demonstrates:

- NIP-42 authentication enforcement for DMs (kind 4)
- Message stashing before authentication completes
- Re-sending stashed messages after successful authentication

## Environment Variables

Configure Pförtner using these environment variables in your `.env` file:

| Variable           | Required | Description                                              | Example                     |
| ------------------ | -------- | -------------------------------------------------------- | --------------------------- |
| `APP_PORT`         | No       | Server listen port                                       | `3000`                      |
| `UPSTREAM_RELAY`   | **Yes**  | WebSocket URL of the upstream relay                      | `wss://relay.example.com`   |
| `UPSTREAM_RAW_URL` | No       | HTTP URL of the upstream relay (for relay info endpoint) | `https://relay.example.com` |

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
- **eventSifterPolicy** — Filter client→relay and relay→client EVENT messages by kind (allow/deny lists)

## Docker Usage

Build the Docker image:

```bash
docker build -t pfortner .
```

Run the container:

```bash
docker run -p 3000:3000 \
  -e UPSTREAM_RELAY=wss://relay.example.com \
  -e APP_PORT=3000 \
  pfortner
```

Or use Docker Compose:

```yaml
services:
  pfortner:
    build: .
    ports:
      - '3000:3000'
    environment:
      - UPSTREAM_RELAY=wss://relay.example.com
      - APP_PORT=3000
      - UPSTREAM_RAW_URL=https://relay.example.com
      - X_FORWARDED_FOR=true
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
