import { parse as parseYaml, stringify as stringifyYaml } from '@std/yaml';
import type { PfortnerConfig, PipelineEntry } from '../../config/loader.ts';

export type PipelineSet = PfortnerConfig['pipelines'];

export type SavePipelinesResult =
  | { status: 'saved'; pipelines: PipelineSet }
  | { error: string; status: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizePipelineEntries(
  value: unknown,
  path: string,
): { entries: PipelineEntry[] } | { error: string } {
  if (!Array.isArray(value)) {
    return { error: `${path} must be an array` };
  }
  const entries: PipelineEntry[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!isRecord(entry)) {
      return { error: `${path}[${i}] must be an object` };
    }
    if (typeof entry.policy !== 'string' || entry.policy.trim().length === 0) {
      return { error: `${path}[${i}].policy must be a non-empty string` };
    }
    const normalized: PipelineEntry = { policy: entry.policy };
    if (entry.config !== undefined) {
      if (!isRecord(entry.config)) {
        return { error: `${path}[${i}].config must be an object` };
      }
      normalized.config = structuredClone(entry.config);
    }
    entries.push(normalized);
  }
  return { entries };
}

export function normalizePipelines(
  value: unknown,
): { pipelines: PipelineSet } | { error: string } {
  if (!isRecord(value)) {
    return { error: 'pipelines object required' };
  }
  const client = normalizePipelineEntries(value.client, 'pipelines.client');
  if ('error' in client) return client;
  const server = normalizePipelineEntries(value.server, 'pipelines.server');
  if ('error' in server) return server;
  return { pipelines: { client: client.entries, server: server.entries } };
}

export function stringifyConfigWithPipelines(
  currentYaml: string,
  pipelines: PipelineSet,
): string {
  const parsed = parseYaml(currentYaml);
  const nextConfig: Record<string, unknown> = isRecord(parsed) ? structuredClone(parsed) : {};
  nextConfig.pipelines = pipelines;
  return stringifyYaml(nextConfig).trimEnd() + '\n';
}

export async function savePipelinesToConfig(
  state: {
    config: PfortnerConfig;
    configPath?: string;
    reloadFn?: (yamlString: string) => Promise<void>;
  },
  pipelinesInput: unknown,
): Promise<SavePipelinesResult> {
  if (!state.configPath || !state.reloadFn) {
    return { error: 'pipeline save not configured', status: 500 };
  }
  const normalized = normalizePipelines(pipelinesInput);
  if ('error' in normalized) {
    return { error: normalized.error, status: 400 };
  }
  try {
    const currentYaml = await Deno.readTextFile(state.configPath);
    const yaml = stringifyConfigWithPipelines(currentYaml, normalized.pipelines);
    await state.reloadFn(yaml);
    await Deno.writeTextFile(state.configPath, yaml);
    return {
      status: 'saved',
      pipelines: state.config.pipelines ?? normalized.pipelines,
    };
  } catch (e) {
    return { error: `pipeline save failed: ${(e as Error).message}`, status: 500 };
  }
}
