import { dotenv, nostrTools } from './deps.ts';

dotenv.loadSync({ export: true, envPath: '.env.test' });

const relay = nostrTools.relayInit(Deno.args[0]);

const sk = Deno.env.get('PRIVKEY') || nostrTools.generatePrivateKey();

function currUnixtime(): number {
  return Math.floor(new Date().getTime() / 1000);
}

relay.on(
  'auth',
  (challenge) =>
    nostrTools.nip42.authenticate({
      relay,
      sign: (e) => nostrTools.finishEvent(e, sk),
      challenge,
    }),
);

await relay.connect();
relay.url = 'wss://yabu.me';

const sub = relay.sub([
  {
    kinds: [4],
    since: currUnixtime(),
  },
]);

sub.on('event', (ev) => console.log(ev));
