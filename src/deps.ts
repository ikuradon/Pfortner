export * as nostrTools from 'npm:nostr-tools@1.17.0';
export * as dotenv from 'https://deno.land/std@0.206.0/dotenv/mod.ts';
// @deno-types="npm:@types/ws@8.5.9"
import WebSocket from 'npm:ws@8.14.2';
export const ws = WebSocket;
export type ws = WebSocket;
export type wsClientOptions = WebSocket.ClientOptions;
