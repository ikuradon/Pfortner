import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';
import { extractEvent } from '../plugins/types.ts';

interface WotConfig {
  enabled: boolean;
  root_pubkeys: string[];
  max_depth: number;
  relay_url?: string;
}

interface PubkeyAclConfig {
  mode: 'allowlist' | 'blocklist';
  target: 'author' | 'client';
  pubkeys?: string[];
  source?: string;
  refresh_interval?: number;
  wot?: WotConfig;
}

export const pubkeyAclPlugin: PolicyPlugin = {
  name: 'pubkey-acl',
  description: 'Filter EVENTs by pubkey allowlist/blocklist',
  direction: 'both',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['allowlist', 'blocklist'] },
      target: { type: 'string', enum: ['author', 'client'] },
      pubkeys: { type: 'array', items: { type: 'string' } },
      source: { type: 'string' },
      refresh_interval: { type: 'number' },
    },
    required: ['mode', 'target'],
  },
  async initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as PubkeyAclConfig;
    const pubkeySet = new Set<string>(cfg.pubkeys ?? []);

    // Fetch external list if configured
    if (cfg.source) {
      try {
        const response = await infra.httpClient.fetch(cfg.source);
        const list: string[] = await response.json();
        for (const pk of list) pubkeySet.add(pk);
        infra.logger.info('Loaded external pubkey list', { source: cfg.source, count: list.length });
      } catch (e) {
        infra.logger.warn('Failed to fetch external pubkey list', { source: cfg.source, error: String(e) });
      }
    }

    // Build WoT graph if configured
    if (cfg.wot?.enabled && cfg.wot.root_pubkeys?.length > 0) {
      try {
        const { buildWotGraph } = await import('../wot/builder.ts');
        const { createRelayQueryFn } = await import('../wot/relay-query.ts');
        const relayUrl = cfg.wot.relay_url ?? 'wss://relay.damus.io';
        const queryFn = createRelayQueryFn(relayUrl, 15000);
        const wotPubkeys = await buildWotGraph(cfg.wot.root_pubkeys, cfg.wot.max_depth, queryFn);
        for (const pk of wotPubkeys) pubkeySet.add(pk);
        infra.logger.info('Built WoT graph', { rootCount: cfg.wot.root_pubkeys.length, totalPubkeys: wotPubkeys.size });
      } catch (e) {
        infra.logger.warn('Failed to build WoT graph', { error: String(e) });
      }
    }

    return (_instance) => {
      return (message, connectionInfo) => {
        const extracted = extractEvent(message);
        if (!extracted) return { message, action: 'next' };

        const event = extracted.event as { id: string; pubkey: string };

        let targetPubkey: string;
        if (cfg.target === 'client') {
          targetPubkey = connectionInfo.clientPubkey;
          if (!targetPubkey) {
            // Unauthenticated: not in any allowlist, in every blocklist
            return cfg.mode === 'allowlist'
              ? {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', event.id, false, 'blocked: not authorized']),
              }
              : { message, action: 'next' };
          }
        } else {
          targetPubkey = event.pubkey;
        }

        const isInList = pubkeySet.has(targetPubkey);

        if (cfg.mode === 'allowlist' && !isInList) {
          return {
            message,
            action: 'reject',
            response: JSON.stringify(['OK', event.id, false, 'blocked: pubkey not allowed']),
          };
        }
        if (cfg.mode === 'blocklist' && isInList) {
          return {
            message,
            action: 'reject',
            response: JSON.stringify(['OK', event.id, false, 'blocked: pubkey blocked']),
          };
        }

        return { message, action: 'next' };
      };
    };
  },
};
