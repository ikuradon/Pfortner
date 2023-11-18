import { authenticate } from "npm:nostr-tools@1.17.0/nip42";
import { nostrTools } from "./deps.ts";

const relay = nostrTools.relayInit("ws://localhost:3000");

const sk = nostrTools.generatePrivateKey();

function currUnixtime(): number {
  return Math.floor(new Date().getTime() / 1000);
}

relay.on("auth", (challenge) =>
  authenticate({ relay, sign: (e) => nostrTools.finishEvent(e, sk), challenge })
);

await relay.connect();
relay.url = "wss://yabu.me";

const sub = relay.sub([
  {
    kinds: [1],
    since: currUnixtime(),
  },
]);

sub.on("event", (ev) => console.log(ev));
