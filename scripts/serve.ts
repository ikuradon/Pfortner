import { dotenv, nostrTools } from './deps.ts';
import { pfortnerInit, type Policy } from '../src/pfortner.ts';
import { acceptPolicy } from '../src/policies/mod.ts';
dotenv.loadSync({ export: true });

const APP_PORT = Number(Deno.env.get('APP_PORT')) || 3000;
const UPSTREAM_RELAY = Deno.env.get('UPSTREAM_RELAY');
if (UPSTREAM_RELAY == undefined) {
  Deno.exit(1);
}
const UPSTREAM_RAW_URL = new URL(Deno.env.get('UPSTREAM_RAW_URL') || 'ws://localhost:3000').href;

const UPSTREAM_URL_HTTP = UPSTREAM_RELAY?.replace('wss://', 'https://').replace('ws://', 'http://');

const appendNip42Proxy = async ({ upstreamHost }: { upstreamHost: string }): Promise<Response> => {
  const response = await fetch(new URL(upstreamHost).href, {
    headers: {
      Accept: 'application/nostr+json',
    },
  });
  const relayInfo = await response.json();
  relayInfo.supported_nips.push(42);
  const headers = new Headers();
  headers.append('Content-Type', 'application/json');
  headers.append('Access-Control-Allow-Origin', '*');
  return new Response(JSON.stringify(relayInfo), { headers });
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

Deno.serve(
  { hostname: '[::]', port: APP_PORT },
  async (req: Request, conn: Deno.ServeHandlerInfo) => {
    if (req.headers.get('accept') === 'application/nostr+json') {
      return await appendNip42Proxy({ upstreamHost: UPSTREAM_URL_HTTP });
    }

    if (req.headers.get('upgrade') != 'websocket') {
      return new Response('Please use a Nostr client to connect.', { status: 400 });
    }

    const clientIp = req.headers.get('X-Forwarded-For') || conn.remoteAddr.hostname || '';

    const stash = new Map<string, nostrTools.Event[]>();

    const pfortner = pfortnerInit(UPSTREAM_RELAY, {
      clientIp,
      sendAuthOnConnect: true,
      upstreamRawAddress: UPSTREAM_RAW_URL,
    });
    // pfortner.on('serverConnect', () => console.log(`${pfortner.connectionInfo.connectionId} serverConnect`));
    // pfortner.on('serverMsg', (message) => console.log(`${pfortner.connectionInfo.connectionId} serverMsg: ${message}`));
    // pfortner.on('serverDisconnect', () => console.log(`${pfortner.connectionInfo.connectionId} serverDisconnect`));

    // pfortner.on('clientConnect', () => console.log(`${pfortner.connectionInfo.connectionId} clientConnect`));
    // pfortner.on('clientMsg', (message) => console.log(`${pfortner.connectionInfo.connectionId} clientMsg: ${message}`));
    // pfortner.on('clientDisconnect', () => console.log(`${pfortner.connectionInfo.connectionId} clientDisconnect`));

    // pfortner.on('clientAuth', () => console.log(`${pfortner.connectionInfo.connectionId} clientAuth`));
    // pfortner.on('authSuccess', () => console.log(`${pfortner.connectionInfo.connectionId} authSuccess`));
    // pfortner.on('authFailed', () => console.log(`${pfortner.connectionInfo.connectionId} authFailed`));

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
    pfortner.on('authSuccess', () => {
      stash.forEach((events: nostrTools.Event[], reqId: string, _) => {
        for (const event of events) {
          if (isRelatedEvent(pfortner.connectionInfo.clientPubkey, event)) {
            const msg = ['EVENT', reqId, event];
            pfortner.sendmessageToClient(JSON.stringify(msg));
          }
        }
      });
    });

    return pfortner.createSession(req);
  },
);
