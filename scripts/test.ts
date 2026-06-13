import { nostrTools } from './deps.ts';
import { Relay } from '@nostr/tools/relay';

// Helper function to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Get relay URL from command line argument
const relayUrl = Deno.args[0] || 'wss://yabu.me';

// Generate or use existing secret key (v2 uses Uint8Array)
const skHex = Deno.env.get('PRIVKEY');
const sk: Uint8Array = skHex ? hexToBytes(skHex) : nostrTools.generateSecretKey();

// Create relay instance
const relay = new Relay(relayUrl);

// Handle AUTH challenges (NIP-42)
relay.onauth = (evt: nostrTools.EventTemplate) => {
  return Promise.resolve(nostrTools.finalizeEvent(evt, sk));
};

// Connect to relay
await relay.connect();
console.log(`Connected to ${relayUrl}`);

// Subscribe to events
const _sub = relay.subscribe(
  [
    {
      kinds: [4],
      // since: Math.floor(Date.now() / 1000),
    },
  ],
  {
    onevent: (ev: nostrTools.Event) => console.log(ev),
  },
);
