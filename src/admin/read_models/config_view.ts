import type { PfortnerConfig } from '../../config/loader.ts';

type MaskableConfig = {
  admin?: { auth_token?: string };
  infra?: { redis?: { url?: string } };
};

export function maskSecrets(config: PfortnerConfig): unknown {
  const masked = JSON.parse(JSON.stringify(config)) as MaskableConfig;
  if (masked.admin?.auth_token) masked.admin.auth_token = '***';
  if (masked.infra?.redis?.url) masked.infra.redis.url = '***';
  return masked;
}
