import { Hono, dotenv, nostrTools, nWebSocket } from "./deps.ts";
dotenv.loadSync({ export: true });

const UPSTREAM_RELAY = Deno.env.get("UPSTREAM_RELAY");
const UPSTREAM_HTTPS = Deno.env.get("UPSTREAM_HTTPS") === "true" ? true : false;
const X_FORWARDED_FOR =
  Deno.env.get("X_FORWARDED_FOR") === "true" ? true : false;

const UPSTREAM_URL_WS = `${
  UPSTREAM_HTTPS ? "wss://" : "ws://"
}${UPSTREAM_RELAY}`;
const UPSTREAM_URL_HTTP = `${
  UPSTREAM_HTTPS ? "https://" : "http://"
}${UPSTREAM_RELAY}`;

console.log(UPSTREAM_URL_WS);
const app = new Hono();

app.get("/", async (c) => {
  if (c.req.header("Accept") === "application/nostr+json") {
    const response = await fetch(UPSTREAM_URL_HTTP, {
      headers: {
        Accept: "application/nostr+json",
      },
    });
    const relayInfo = await response.json();
    console.log(relayInfo.supported_nips.push(42));
    return c.json(relayInfo);
  }

  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Please use a Nostr client to connect.", 400);
  }

  const clientIp = c.req.header("X-Forwarded-For");
  const connectionId = crypto.randomUUID();
  // const serverSocket = new WebSocket(UPSTREAM_URL_WS);
  const reqOptions = {};
  if (X_FORWARDED_FOR && clientIp != null) {
    reqOptions["X-Forwarded-For"] = clientIp;
  }
  const serverSocket = new nWebSocket(UPSTREAM_URL_WS, [], reqOptions);
  let serverConnected = false;
  let clientConnected = false;
  let clientAuthorized = false;
  let userPubkey: string;

  const stash = new Map<string, nostrTools.Event[]>();

  serverSocket.addEventListener("open", (e) => {
    console.log(`${connectionId} S2C (open): ${e}`);
    serverConnected = true;
  });
  serverSocket.addEventListener("message", (e) => {
    const packet = e.data;
    console.log(`${connectionId} S2C (message): ${e}`);

    try {
      const packetData = JSON.parse(packet);
      if (packetData.length === 3 && packetData[0] === "EVENT") {
        const event = packetData[2] as nostrTools.Event;
        if (!clientAuthorized && event.kind === 4) {
          const reqId = packetData[1];
          console.log(`Add ${event.id} to stash ${reqId}`);
          const reqStash = stash.get(reqId) ?? ([] as nostrTools.Event[]);
          reqStash.push(event);
          stash.set(reqId, reqStash);
        }
        if (event.kind !== 4) return clientSocket.send(packet);
        if (isRelatedEvent(event)) return clientSocket.send(packet);
      } else {
        return clientSocket.send(packet);
      }
    } catch (e) {
      console.log(e);
    }
  });
  serverSocket.addEventListener("close", (e) => {
    console.log(`${connectionId} S2C (close): ${e}`);
    if (clientConnected) {
      clientSocket.close();
      clientConnected = false;
    }
  });

  function sendAuthMessage(): void {
    const packet = ["AUTH"];
    packet.push(connectionId);

    clientSocket.send(JSON.stringify(packet));
  }

  function verifyAuthMessage(packet: string): void {
    console.log("AUTH");
    try {
      const packetData = JSON.parse(packet);
      const event = JSON.parse(packetData[1]) as nostrTools.Event;
      if (
        nostrTools.validateEvent(event) &&
        nostrTools.verifySignature(event) &&
        event.kind === 22242
      ) {
        event.tags.forEach((tag) => {
          if (
            tag.length === 2 &&
            tag[0] === "challenge" &&
            tag[1] === connectionId
          )
            userPubkey = event.pubkey;
        });
      }

      if (userPubkey == null) {
        clientSocket.send(
          JSON.stringify(["NOTICE", "restricted: auth failed."])
        );
      } else {
        clientAuthorized = true;
        sendStash();
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
          const message = ["EVENT", reqId, event];
          clientSocket.send(JSON.stringify(message));
        }
      }
    });
    stash.clear();
  }

  function isRelatedEvent(ev: nostrTools.Event): boolean {
    if (ev.pubkey === userPubkey) return true;
    for (const tag of ev.tags) {
      if (tag[0] === "p" && tag[1] === userPubkey) return true;
    }
    return false;
  }

  const { response, socket: clientSocket } = Deno.upgradeWebSocket(c.req.raw);
  clientSocket.addEventListener("open", (e) => {
    console.log(`${connectionId} C2S (open): ${e}`);
    clientConnected = true;
    sendAuthMessage();
  });
  clientSocket.addEventListener("message", async (e: MessageEvent) => {
    const packet = e.data;
    console.log(`${connectionId} C2S (message): ${packet}`);

    const packetData = (() => {
      try {
        return JSON.parse(packet);
      } catch (_) {
        return null;
      }
    })();
    if (packetData.length === 2 && packetData[0] === "AUTH") {
      if (!clientAuthorized) verifyAuthMessage(packet);
    } else {
      while (serverSocket.readyState !== serverSocket.OPEN) {
        console.log(
          `${connectionId} C2S connecting...: ${serverSocket.readyState}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (packetData[0] === "REQ" && !clientAuthorized) {
        stash.set(packetData[1], [] as nostrTools.Event[]);
      } else if (packetData[0] === "CLOSE" && !clientAuthorized) {
        stash.delete(packetData[1]);
      }

      serverSocket.send(packet);
    }
  });
  clientSocket.addEventListener("close", (e) => {
    console.log(`${connectionId} C2S (close): ${e}`);
    if (serverConnected) {
      serverSocket.close();
      serverConnected = false;
    }
  });

  return response;
});

Deno.serve({ port: 3000 }, app.fetch);
