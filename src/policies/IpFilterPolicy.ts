import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';

interface IpFilterConfig {
  blocklist?: {
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
      blocklist: {
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
    const blockedIps = new Set(cfg.blocklist?.ips ?? []);
    const cidrs = cfg.blocklist?.cidrs ?? [];

    // Fetch external list if configured
    if (cfg.blocklist?.source) {
      try {
        const response = await infra.httpClient.fetch(cfg.blocklist.source);
        const text = await response.text();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) blockedIps.add(trimmed);
        }
        infra.logger.info('Loaded external IP blocklist', { source: cfg.blocklist.source, count: blockedIps.size });
      } catch (e) {
        infra.logger.warn('Failed to fetch external IP blocklist', { source: cfg.blocklist.source, error: String(e) });
      }
    }

    // Fetch Tor exit node list if block_tor is enabled
    if (cfg.block_tor) {
      try {
        const response = await infra.httpClient.fetch('https://check.torproject.org/torbulkexitlist');
        const text = await response.text();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) blockedIps.add(trimmed);
        }
        infra.logger.info('Loaded Tor exit node list', { count: blockedIps.size });
      } catch (e) {
        infra.logger.warn('Failed to fetch Tor exit node list', { error: String(e) });
      }
    }

    // Load GeoIP database if block_countries and geoip_db are configured
    let geoLookup: ((ip: string) => string | null) | null = null;
    if (cfg.block_countries?.length && cfg.geoip_db) {
      try {
        const { createGeoIpLookup } = await import('../infra/geoip.ts');
        geoLookup = await createGeoIpLookup(cfg.geoip_db);
        if (geoLookup) {
          infra.logger.info('GeoIP database loaded', { path: cfg.geoip_db });
        } else {
          infra.logger.warn('GeoIP database not found', { path: cfg.geoip_db });
        }
      } catch (e) {
        infra.logger.warn('Failed to load GeoIP database', { error: String(e) });
      }
    }
    const blockedCountries = new Set(cfg.block_countries ?? []);

    return (_instance) => {
      let checked = false;
      let blocked = false;

      return (message, connectionInfo) => {
        // Check IP once per connection
        if (!checked) {
          checked = true;
          const ip = connectionInfo.connectionIpAddr;

          if (blockedIps.has(ip)) {
            blocked = true;
          } else {
            for (const cidr of cidrs) {
              if (cidrContains(cidr, ip)) {
                blocked = true;
                break;
              }
            }
          }

          if (!blocked && geoLookup && blockedCountries.size > 0) {
            const country = geoLookup(ip);
            if (country && blockedCountries.has(country)) {
              blocked = true;
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
