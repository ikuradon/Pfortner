import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';

interface IpFilterConfig {
  blacklist?: {
    ips?: string[];
    cidrs?: string[];
    source?: string;
    refresh_interval?: number;
  };
  block_tor?: boolean;
  block_countries?: string[];
  geoip_db?: string;
}

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToNumber(ip) & mask) === (ipToNumber(network) & mask);
}

export const ipFilterPlugin: PolicyPlugin = {
  name: 'ip-filter',
  description: 'Block connections by IP address or CIDR range',
  direction: 'client',
  configSchema: {
    type: 'object',
    properties: {
      blacklist: {
        type: 'object',
        properties: {
          ips: { type: 'array', items: { type: 'string' } },
          cidrs: { type: 'array', items: { type: 'string' } },
          source: { type: 'string' },
        },
      },
      block_tor: { type: 'boolean' },
    },
  },
  async initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as IpFilterConfig;
    const blacklistedIps = new Set(cfg.blacklist?.ips ?? []);
    const cidrs = cfg.blacklist?.cidrs ?? [];

    // Fetch external list if configured
    if (cfg.blacklist?.source) {
      try {
        const response = await infra.httpClient.fetch(cfg.blacklist.source);
        const text = await response.text();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) blacklistedIps.add(trimmed);
        }
        infra.logger.info('Loaded external IP blocklist', { source: cfg.blacklist.source, count: blacklistedIps.size });
      } catch (e) {
        infra.logger.warn('Failed to fetch external IP blocklist', { source: cfg.blacklist.source, error: String(e) });
      }
    }

    return (_instance) => {
      let checked = false;
      let blocked = false;

      return (message, connectionInfo) => {
        // Check IP once per connection
        if (!checked) {
          checked = true;
          const ip = connectionInfo.connectionIpAddr;

          if (blacklistedIps.has(ip)) {
            blocked = true;
          } else {
            for (const cidr of cidrs) {
              if (cidrContains(cidr, ip)) {
                blocked = true;
                break;
              }
            }
          }
        }

        if (blocked) {
          return { message, action: 'reject', response: JSON.stringify(['NOTICE', 'blocked: IP not allowed']) };
        }
        return { message, action: 'next' };
      };
    };
  },
};
