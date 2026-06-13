import { stringify } from '@std/yaml';
import type { RuntimeBackendAvailability } from '../config/loader.ts';
import { loadProductionConfigFromString } from '../config/loader.ts';
import type { DataDirLayout } from './data_dir.ts';

export type BootstrapState = { mode: 'setup' } | { mode: 'normal'; configPath: string };

export interface SetupConfigInput {
  upstreamRelay: string;
  relayName: string;
  relayDescription: string;
}

export class SetupConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupConfigValidationError';
  }
}

export async function detectBootstrapState(layout: DataDirLayout): Promise<BootstrapState> {
  try {
    const stat = await Deno.stat(layout.configPath);
    if (stat.isFile) return { mode: 'normal', configPath: layout.configPath };
    throw new Error(`${layout.configPath} exists but is not a file`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { mode: 'setup' };
    throw error;
  }
}

export function validateUpstreamRelay(value: string): string {
  const upstreamRelay = value.trim();
  if (!upstreamRelay) throw new SetupConfigValidationError('upstream_relay is required');

  let parsed: URL;
  try {
    parsed = new URL(upstreamRelay);
  } catch {
    throw new SetupConfigValidationError('upstream_relay must be a valid ws:// or wss:// URL');
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new SetupConfigValidationError('upstream_relay must use ws:// or wss://');
  }
  return upstreamRelay;
}

export function buildSetupConfigYaml(input: SetupConfigInput): string {
  const upstreamRelay = validateUpstreamRelay(input.upstreamRelay);
  return stringify({
    server: { upstream_relay: upstreamRelay },
    relay_info: {
      name: input.relayName || 'Pfortner Relay',
      description: input.relayDescription || '',
    },
    pipelines: {
      client: [{ policy: 'accept' }],
      server: [{ policy: 'accept' }],
    },
  });
}

export async function saveSetupConfig(
  layout: DataDirLayout,
  input: SetupConfigInput,
  runtime: { backend: RuntimeBackendAvailability },
): Promise<void> {
  const yaml = buildSetupConfigYaml(input);
  loadProductionConfigFromString(yaml, runtime);
  await assertConfigPathAvailable(layout.configPath);

  const tmp = `${layout.configPath}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, yaml);
  try {
    await assertConfigPathAvailable(layout.configPath);
    await Deno.link(tmp, layout.configPath);
  } catch (error) {
    await removeIfExists(tmp);
    throw error;
  }
  await removeIfExists(tmp);
}

async function assertConfigPathAvailable(path: string): Promise<void> {
  try {
    const stat = await Deno.stat(path);
    if (stat.isFile) throw new Error(`${path} already exists`);
    throw new Error(`${path} exists but is not a file`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
