import { dotenv, nostrTools, ws, type wsClientOptions } from './deps.ts';
dotenv.loadSync({ export: true });

const APP_PORT = Number(Deno.env.get('APP_PORT')) || 3000;
const UPSTREAM_RELAY = Deno.env.get('UPSTREAM_RELAY');
const UPSTREAM_HTTPS = Deno.env.get('UPSTREAM_HTTPS') === 'true' ? true : false;
const UPSTREAM_RAW_URL = new URL(Deno.env.get('UPSTREAM_RAW_URL') || 'ws://localhost:3000').toString();
const X_FORWARDED_FOR = Deno.env.get('X_FORWARDED_FOR') === 'true' ? true : false;

const UPSTREAM_URL_WS = `${UPSTREAM_HTTPS ? 'wss://' : 'ws://'}${UPSTREAM_RELAY}`;
const UPSTREAM_URL_HTTP = `${UPSTREAM_HTTPS ? 'https://' : 'http://'}${UPSTREAM_RELAY}`;

console.log(UPSTREAM_URL_WS);

const appendNip42Proxy = async ({ upstreamHost }: { upstreamHost: string }): Promise<Response> => {
  const response = await fetch(new URL(upstreamHost).href, {
    headers: {
      Accept: 'application/nostr+json',
    },
  });
  const relayInfo = await response.json();
  relayInfo.supported_nips.push(42);
  return new Response(JSON.stringify(relayInfo));
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
    const connectionId = crypto.randomUUID();
    const reqOptions: wsClientOptions = {};
    if (X_FORWARDED_FOR && clientIp != null) {
      reqOptions.headers = { 'X-Forwarded-For': clientIp };
    }
    const serverSocket = new ws(UPSTREAM_URL_WS, [], reqOptions);
    let serverConnected = false;
    let clientConnected = false;
    let clientAuthorized = false;
    let clientPubkey: string;

    const stash = new Map<string, nostrTools.Event[]>();

    serverSocket.addEventListener('open', (e) => {
      console.log(`${connectionId} S2C (open): ${e}`);
      serverConnected = true;
    });
    serverSocket.addEventListener('message', (e) => {
      const json = e.data;
      console.log(`${connectionId} S2C (message): ${json}`);

      try {
        const packetData = JSON.parse(json);
        if (packetData.length === 3 && packetData[0] === 'EVENT') {
          const event = packetData[2] as nostrTools.Event;
          if (!clientAuthorized && event.kind === 4) {
            const reqId = packetData[1];
            console.log(`Add ${event.id} to stash ${reqId}`);
            const reqStash = stash.get(reqId) ?? ([] as nostrTools.Event[]);
            reqStash.push(event);
            stash.set(reqId, reqStash);
          }
          if (event.kind !== 4) return clientSocket.send(json);
          if (isRelatedEvent(event)) return clientSocket.send(json);
        } else {
          return clientSocket.send(json);
        }
      } catch (e) {
        console.log(e);
      }
    });
    serverSocket.addEventListener('close', (e) => {
      console.log(`${connectionId} S2C (close): ${e}`);
      if (clientConnected) {
        clientSocket.close();
        clientConnected = false;
      }
    });

    function sendAuthMessage(): void {
      const packet = ['AUTH'];
      packet.push(connectionId);

      clientSocket.send(JSON.stringify(packet));
    }

    function currUnixtime(): number {
      return Math.floor(new Date().getTime() / 1000);
    }
    function validateEventTime(ev: nostrTools.Event): boolean {
      const now = currUnixtime();
      const allowedTimeDuration = 10 * 60;
      if (
        ev.created_at > now - allowedTimeDuration &&
        ev.created_at < now + allowedTimeDuration
      ) {
        return true;
      }
      return false;
    }

    function verifyAuthMessage(json: string): void {
      console.log('AUTH');
      let checkChallenge = false;
      let checkRelay = false;
      try {
        const packet = JSON.parse(json);
        const event = packet[1] as nostrTools.Event;
        if (
          nostrTools.validateEvent(event) &&
          nostrTools.verifySignature(event) &&
          event.kind === 22242 &&
          validateEventTime(event)
        ) {
          event.tags.forEach((tag) => {
            if (
              tag.length === 2 &&
              tag[0] === 'challenge' &&
              tag[1] === connectionId
            ) {
              checkChallenge = true;
            } else if (
              tag.length === 2 &&
              tag[0] === 'relay' &&
              new URL(tag[1]).toString() === UPSTREAM_RAW_URL
            ) {
              checkRelay = true;
            }
          });
        }

        if (checkChallenge && checkRelay) {
          console.log('AUTH OK');
          clientPubkey = event.pubkey;
          clientAuthorized = true;
          sendStash();
        } else {
          console.log('AUTH NG');
          clientSocket.send(
            JSON.stringify(['NOTICE', 'restricted: auth failed.']),
          );
        }
      } catch (e) {
        console.log(e);
      }
    }

    function sendStash(): void {
      stash.forEach((events: nostrTools.Event[], reqId: string, _) => {
        console.log(reqId);
        for (const event of events) {
          if (isRelatedEvent(event)) {
            const message = ['EVENT', reqId, event];
            clientSocket.send(JSON.stringify(message));
          }
        }
      });
      stash.clear();
    }

    function isRelatedEvent(ev: nostrTools.Event): boolean {
      if (ev.pubkey === clientPubkey) return true;
      for (const tag of ev.tags) {
        if (
          tag[0] === 'p' &&
          tag[1] === clientPubkey
        ) return true;
      }
      return false;
    }

    const { response, socket: clientSocket } = Deno.upgradeWebSocket(req);
    clientSocket.addEventListener('open', (e) => {
      console.log(`${connectionId} C2S (open): ${e}`);
      clientConnected = true;
      sendAuthMessage();
    });
    clientSocket.addEventListener('message', async (e: MessageEvent) => {
      const json = e.data;
      console.log(`${connectionId} C2S (message): ${json}`);

      const packetData = (() => {
        try {
          return JSON.parse(json);
        } catch (_) {
          return null;
        }
      })();
      if (packetData == null) return;
      if (
        packetData.length === 2 &&
        packetData[0] === 'AUTH'
      ) {
        if (!clientAuthorized) verifyAuthMessage(json);
      } else {
        while (serverSocket.readyState !== serverSocket.OPEN) {
          console.log(
            `${connectionId} C2S:  connecting...`,
          );
          await new Promise<void>((resolve, reject) => {
            serverSocket.addEventListener('open', () => resolve());
            serverSocket.addEventListener('error', () => reject());
          });
        }

        if (
          packetData[0] === 'REQ' &&
          !clientAuthorized
        ) {
          stash.set(packetData[1], [] as nostrTools.Event[]);
        } else if (
          packetData[0] === 'CLOSE' &&
          !clientAuthorized
        ) {
          stash.delete(packetData[1]);
        }

        serverSocket.send(json);
      }
    });
    clientSocket.addEventListener('close', (e) => {
      console.log(`${connectionId} C2S (close): ${e}`);
      if (serverConnected) {
        serverSocket.close();
        serverConnected = false;
      }
    });

    return response;
  },
);
