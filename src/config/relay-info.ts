import type { PfortnerConfig, PipelineEntry } from './loader.ts';

export interface RelayInfo {
  name: string;
  description: string;
  software: string;
  version?: string;
  contact?: string;
  supported_nips: number[];
  limitation?: {
    auth_required?: boolean;
    min_pow_difficulty?: number;
    max_content_length?: number;
  };
}

function findPolicyConfig(entries: PipelineEntry[], policyName: string): Record<string, unknown> | undefined {
  return entries.find((e) => e.policy === policyName)?.config;
}

export function buildRelayInfo(config: PfortnerConfig): RelayInfo {
  const allEntries = [...config.pipelines.client, ...config.pipelines.server];
  const nips = new Set<number>([1, 42]); // Always supported
  const limitation: RelayInfo['limitation'] = {};

  // NIP-13: PoW
  const spamConfig = findPolicyConfig(allEntries, 'spam-filter');
  if (spamConfig?.min_pow != null) {
    nips.add(13);
    limitation.min_pow_difficulty = spamConfig.min_pow as number;
  }

  // NIP-70: Protected events
  const protectedConfig = findPolicyConfig(allEntries, 'protected-event');
  if (protectedConfig?.require_auth) {
    nips.add(70);
  }

  // Auth required
  const writeGuardConfig = findPolicyConfig(allEntries, 'write-guard');
  if (writeGuardConfig?.require_auth) {
    limitation.auth_required = true;
  }

  // Content length
  if (spamConfig?.max_content_length != null) {
    limitation.max_content_length = spamConfig.max_content_length as number;
  }

  return {
    name: config.relay_info?.name ?? 'Pförtner Proxy',
    description: config.relay_info?.description ?? '',
    software: config.relay_info?.software ?? 'pfortner',
    ...(config.relay_info?.contact ? { contact: config.relay_info.contact } : {}),
    supported_nips: [...nips].sort((a, b) => a - b),
    ...(Object.keys(limitation).length > 0 ? { limitation } : {}),
  };
}
