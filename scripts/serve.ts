import { acceptPolicy, pfortnerInit, type Policy } from '../mod.ts';
import { dotenv, log, nostrTools } from './deps.ts';
dotenv.loadSync({ export: true });

const APP_PORT = Number(Deno.env.get('APP_PORT')) || 3000;
const UPSTREAM_RELAY = Deno.env.get('UPSTREAM_RELAY');
if (UPSTREAM_RELAY == undefined) {
  log.error('UPSTREAM_RELAY environment variable is required');
  Deno.exit(1);
}

let UPSTREAM_RAW_URL: string;
try {
  UPSTREAM_RAW_URL = new URL(Deno.env.get('UPSTREAM_RAW_URL') || UPSTREAM_RELAY).href;
} catch {
  log.error('Invalid UPSTREAM_RAW_URL');
  Deno.exit(1);
}

const UPSTREAM_URL_HTTP = UPSTREAM_RELAY.replace('wss://', 'https://').replace('ws://', 'http://');

const appendNip42Proxy = async ({ upstreamHost }: { upstreamHost: string }): Promise<Response> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/json');
  headers.append('Access-Control-Allow-Origin', '*');

  try {
    const response = await fetch(new URL(upstreamHost).href, {
      headers: {
        Accept: 'application/nostr+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Upstream relay returned status ${response.status}`);
    }

    const relayInfo = await response.json();

    // Ensure supported_nips exists and is an array
    if (!Array.isArray(relayInfo.supported_nips)) {
      relayInfo.supported_nips = [];
    }

    // Add NIP-42 only if not already present
    if (!relayInfo.supported_nips.includes(42)) {
      relayInfo.supported_nips.push(42);
    }

    return new Response(JSON.stringify(relayInfo), { headers });
  } catch (error) {
    log.warn(`Failed to fetch upstream relay info: ${error instanceof Error ? error.message : String(error)}`);

    // Return a minimal relay info with NIP-42 support as fallback
    const fallbackInfo = {
      name: 'Pförtner Proxy',
      description: 'Nostr relay proxy with NIP-42 authentication',
      supported_nips: [42],
    };

    return new Response(JSON.stringify(fallbackInfo), { headers });
  }
};

const isRelatedEvent = (pubkey: string, event: nostrTools.Event): boolean => {
  if (event.pubkey === pubkey) return true;
  for (const tag of event.tags) {
    if (
      tag[0] === 'p' &&
      tag[1] === pubkey
    ) return true;
  }
  return false;
};

const filterDmPolicy: Policy<Map<string, nostrTools.Event[]>> = (message, connectionInfo, stash) => {
  if (message[0] !== 'EVENT' || message.length !== 3) {
    return { message, action: 'next' };
  }

  const reqId = message[1] as string;
  const event = message[2] as nostrTools.Event;
  if (event.kind !== 4) {
    return { message, action: 'next' };
  }

  if (!connectionInfo.clientAuthorized) {
    const reqStash = stash?.get(reqId) ?? ([] as nostrTools.Event[]);
    reqStash.push(event);
    stash?.set(reqId, reqStash);
    return { message, action: 'reject' };
  } else if (isRelatedEvent(connectionInfo.clientPubkey, event)) {
    return { message, action: 'accept' };
  } else {
    return { message, action: 'reject' };
  }
};

globalThis.addEventListener('unhandledrejection', (e) => {
  log.error(`Unhandled rejection: ${e.reason}`);
  e.preventDefault();
});

Deno.serve(
  { hostname: '[::]', port: APP_PORT },
  async (req: Request, conn: Deno.ServeHandlerInfo) => {
    if (req.headers.get('accept') === 'application/nostr+json') {
      return await appendNip42Proxy({ upstreamHost: UPSTREAM_URL_HTTP });
    }

    if (req.headers.get('upgrade') != 'websocket') {
      return new Response('Please use a Nostr client to connect.', { status: 400 });
    }

    const clientIp = req.headers.get('X-Forwarded-For') ||
      ('hostname' in conn.remoteAddr ? conn.remoteAddr.hostname : '');

    const stash = new Map<string, nostrTools.Event[]>();

    const pfortner = pfortnerInit(UPSTREAM_RELAY, {
      clientIp,
      sendAuthOnConnect: true,
      upstreamRawAddress: UPSTREAM_RAW_URL,
    });

    pfortner.registerClientPipeline([acceptPolicy]);
    pfortner.registerServerPipeline([[filterDmPolicy, stash], acceptPolicy]);

    pfortner.on('clientRequest', (requestId) => {
      if (!pfortner.connectionInfo.clientAuthorized) {
        stash.set(requestId, [] as nostrTools.Event[]);
      }
    });
    pfortner.on('clientClose', (requestId) => {
      if (!pfortner.connectionInfo.clientAuthorized) {
        stash.delete(requestId);
      }
    });
    pfortner.on('authSuccess', (event) => {
      pfortner.sendMessageToClient(JSON.stringify(['OK', event.id, true, '']));

      stash.forEach((events: nostrTools.Event[], reqId: string, _) => {
        for (const event of events) {
          if (isRelatedEvent(pfortner.connectionInfo.clientPubkey, event)) {
            const msg = ['EVENT', reqId, event];
            pfortner.sendMessageToClient(JSON.stringify(msg));
          }
        }
      });
    });
    pfortner.on('clientDisconnect', () => {
      stash.clear();
    });

    return pfortner.createSession(req);
  },
);
