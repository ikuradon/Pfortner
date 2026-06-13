# Pförtner

Pförtner is an Admin UI first Nostr relay proxy. Run it in front of an upstream relay, connect Nostr
clients to Pförtner, and manage filtering, rate limits, routing, authentication requirements, and relay
operations from the browser.

Pförtner is designed to be used as a server product:

- Pull or build a Docker image.
- Mount a persistent data directory at `/data`.
- Open `/admin` to finish first-run setup.
- Edit policies and operational settings from the Admin UI or `/data/config.yaml`.

## Features

- Nostr WebSocket relay proxy for client-to-relay traffic.
- Browser Admin UI served on the same port at `/admin`.
- First-run setup flow that creates a complete pass-through config.
- Client and server policy pipelines.
- Pipeline Workbench for editing, testing, drafting, and publishing policy changes.
- Built-in NIP-42 aware policies.
- Runtime health endpoint at `/health`.
- Optional Prometheus metrics at `/metrics`.
- Local Deno KV backend by default, with Redis support for shared policy state.
- Docker-first runtime with all durable state stored under `dataDir`.

## Quick Start

### Docker Image

```bash
docker run --name pfortner \
  -p 3000:3000 \
  -v pfortner-data:/data \
  ghcr.io/ikuradon/pfortner:latest
```

If you want to provide the Admin token explicitly:

```bash
docker run --name pfortner \
  -p 3000:3000 \
  -v pfortner-data:/data \
  -e PFORTNER_ADMIN_TOKEN='change-me' \
  ghcr.io/ikuradon/pfortner:latest
```

If no token is provided, Pförtner generates one and stores it in `/data/admin-token`.

```bash
docker exec pfortner cat /data/admin-token
```

Open the Admin UI:

```text
http://localhost:3000/admin
```

Log in with the Admin token, enter the upstream relay URL, and save setup.

```text
wss://relay.example.com
```

After setup, connect Nostr clients to:

```text
ws://localhost:3000
```

### Docker Compose

```yaml
services:
  pfortner:
    image: ghcr.io/ikuradon/pfortner:latest
    restart: unless-stopped
    ports:
      - '3000:3000'
    volumes:
      - pfortner-data:/data
    environment:
      PFORTNER_LOG_LEVEL: info
      PFORTNER_LOG_FORMAT: text

volumes:
  pfortner-data:
```

### Build Locally

```bash
docker build -t pfortner:local .

docker run --name pfortner \
  -p 3000:3000 \
  -v pfortner-data:/data \
  pfortner:local
```

## First-Run Setup

Pförtner uses a persistent `dataDir`. In Docker, the default is `/data`.

On an empty data directory:

- `/admin` opens the setup UI.
- `/health` returns `{"status":"setup_required"}`.
- Relay WebSocket traffic returns `503` until setup is complete.
- Setup requires the Admin token.

The setup form asks for:

- upstream relay URL, for example `wss://relay.example.com`
- relay name
- relay description

When saved, Pförtner writes `/data/config.yaml` and switches to normal relay mode without requiring a
container restart.

The generated starter config is pass-through:

```yaml
server:
  upstream_relay: wss://relay.example.com

relay_info:
  name: Pfortner Relay
  description: ''

pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
```

## Operating Pförtner

### Endpoints

| Endpoint                                  | Purpose                          |
| ----------------------------------------- | -------------------------------- |
| `/admin`                                  | Admin UI                         |
| `/health`                                 | health status                    |
| `/metrics`                                | Prometheus metrics, when enabled |
| `/` with `Accept: application/nostr+json` | NIP-11 relay information         |
| `/` WebSocket upgrade                     | Nostr relay proxy endpoint       |

### Data Directory

```text
/data/
  config.yaml                    # relay and policy configuration
  admin-token                    # generated or reused Admin token
  pipeline-workbench.draft.json  # Admin UI draft state
  kv/
    pfortner.sqlite3             # local state backend
  plugins/                       # local external plugins
  geoip/                         # GeoIP database files
```

Keep `/data` on persistent storage. Deleting it removes the config, generated Admin token, local backend
state, and Admin UI drafts.

## Configuration

Pförtner separates startup settings from relay configuration.

Use environment variables for process-level settings and secrets:

- listen address and port
- Admin UI enablement and token source
- logging
- trusted proxy behavior
- Redis connection
- data directory location

Use `/data/config.yaml` for relay behavior:

- upstream relay
- relay metadata
- auth behavior
- connection limits
- shutdown behavior
- metrics enablement
- external plugins
- client and server policy pipelines

### Environment Variables

| Variable                    | Default                  | Description                                                        |
| --------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `PFORTNER_DATA_DIR`         | `/data`                  | Durable state directory                                            |
| `PFORTNER_LISTEN_ADDR`      | `[::]`                   | Listen address                                                     |
| `PFORTNER_LISTEN_PORT`      | `3000`                   | Listen port                                                        |
| `PFORTNER_ADMIN_ENABLED`    | `true`                   | Enables `/admin` and Admin API                                     |
| `PFORTNER_ADMIN_TOKEN`      | unset                    | Admin token value                                                  |
| `PFORTNER_ADMIN_TOKEN_FILE` | `${dataDir}/admin-token` | Admin token file                                                   |
| `PFORTNER_LOG_LEVEL`        | `info`                   | `debug`, `info`, `warn`, or `error`                                |
| `PFORTNER_LOG_FORMAT`       | `text`                   | `text` or `json`                                                   |
| `PFORTNER_TRUST_PROXY`      | `false`                  | Trust forwarded headers for client IP and Admin CSRF origin checks |
| `PFORTNER_REDIS_URL`        | unset                    | Redis URL for shared policy state                                  |
| `PFORTNER_REDIS_URL_FILE`   | unset                    | File containing the Redis URL                                      |
| `PFORTNER_REDIS_KEY_PREFIX` | unset                    | Redis key prefix                                                   |

Admin token precedence:

1. `PFORTNER_ADMIN_TOKEN`
2. `PFORTNER_ADMIN_TOKEN_FILE`
3. generated token at `${dataDir}/admin-token`

Set `PFORTNER_ADMIN_ENABLED=false` only after `/data/config.yaml` already exists. An empty data directory
cannot be configured without the Admin UI.

### Config File

`/data/config.yaml` intentionally does not own listen port, Admin token, Redis URL, or logging level.
Those values belong to the runtime environment.

Example:

```yaml
server:
  upstream_relay: wss://relay.example.com
  upstream_raw_url: https://relay.example.com
  idle_timeout: 600
  connections:
    max: 10000
    max_per_ip: 50
    pressure:
      soft_limit_percent: 90
      auth_grace_period: 30
  shutdown:
    drain_timeout: 10
    force_after: 30

auth:
  enabled: true
  send_on_connect: false
  max_attempts: 10
  allowed_time_duration: 600
  allowed_future_time_duration: 60

relay_info:
  name: Pfortner Relay
  description: Nostr relay proxy powered by Pförtner
  contact: admin@example.com

infra:
  http:
    default_timeout: 10
    user_agent: pfortner
  metrics:
    prometheus:
      enabled: true

pipelines:
  client:
    - policy: write-guard
      config:
        require_auth: true
    - policy: rate-limit
      config:
        scope: connection
        window: 60
        max_events: 60
        max_requests: 120
    - policy: accept
  server:
    - policy: accept
```

## Admin UI

The Admin UI is available at `/admin`.

- Dashboard: relay health and runtime status.
- Connections: inspect and disconnect active connections.
- Pipelines: edit, test, draft, and publish policy pipelines.
- Metrics: throughput and Prometheus output.
- Blocklist: manage blocked pubkeys and IPs.
- Config: inspect masked config and reload changes.
- Logs: view buffered logs and live log stream.

## Policies

Policies are applied in order. A policy returns one of three actions:

- `accept`: forward the message and stop the pipeline.
- `reject`: block the message and stop the pipeline.
- `next`: pass the message to the next policy.

Pförtner has two pipeline directions:

- `client`: messages from Nostr clients to the upstream relay.
- `server`: messages from the upstream relay back to clients.

Built-in policy plugins:

- `accept`
- `kind-filter`
- `write-guard`
- `protected-event`
- `rate-limit`
- `spam-filter`
- `content-filter`
- `pubkey-acl`
- `ip-filter`
- `when`
- `match`
- `route`

## Library API

Pförtner also exposes a Deno library API for embedding and tests.

```typescript
import {
  acceptPolicy,
  pfortnerInit,
  type Policy,
} from 'https://raw.githubusercontent.com/ikuradon/Pfortner/main/mod.ts';

const myPolicy: Policy = (message) => {
  if (message[0] === 'EVENT') return { message, action: 'next' };
  return { message, action: 'accept' };
};

const pfortner = pfortnerInit('wss://relay.example.com');

pfortner.registerClientPipeline([
  myPolicy,
  acceptPolicy,
]);

pfortner.registerServerPipeline([
  acceptPolicy,
]);
```

Each `pfortnerInit()` instance represents one client connection. Create a new instance for each incoming
WebSocket client.

## Development

```bash
deno fmt --check --config deno.json
deno lint --config deno.json
deno check mod.ts
deno task test
deno task build:admin-assets
docker build -t pfortner:local .
```

For local server development:

```bash
mkdir -p .data
PFORTNER_DATA_DIR=.data deno task dev
```

## License

Pförtner is licensed under the MIT License. See [LICENSE](LICENSE) for details.
