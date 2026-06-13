import type { InfraContext, PolicyFactory } from '../plugins/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import type { PipelineEntry } from './loader.ts';
import AjvModule from 'ajv';
import { instrumentPolicyFactory } from '../infra/relay-metrics.ts';

// deno-lint-ignore no-explicit-any
const AjvClass = (AjvModule as any).default ?? AjvModule;
const ajv = new AjvClass({ allErrors: true });

export interface ResolvedPipeline {
  factories: PolicyFactory[];
  direction: 'client' | 'server';
}

export async function resolvePipeline(
  entries: PipelineEntry[],
  direction: 'client' | 'server',
  registry: PluginRegistry,
  infra: InfraContext,
): Promise<ResolvedPipeline> {
  const factories: PolicyFactory[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const plugin = registry.resolve(entry.policy);
    if (plugin.direction !== 'both' && plugin.direction !== direction) {
      throw new Error(
        `Plugin "${plugin.name}" has direction "${plugin.direction}" but is placed in "${direction}" pipeline (pipelines.${direction}[${i}])`,
      );
    }
    const pluginConfig = entry.config ?? {};
    if (Object.keys(plugin.configSchema).length > 0) {
      const validate = ajv.compile(plugin.configSchema);
      if (!validate(pluginConfig)) {
        const errors = validate.errors?.map((e: any) => `${e.instancePath} ${e.message}`).join('; ');
        throw new Error(
          `Config validation failed for plugin "${plugin.name}" at pipelines.${direction}[${i}]: ${errors}`,
        );
      }
    }
    const infraForPlugin: InfraContext = { ...infra, currentDirection: direction };
    const factory = await plugin.initialize(pluginConfig, infraForPlugin);
    factories.push(instrumentPolicyFactory(factory, {
      direction,
      policy: plugin.name,
      metrics: infra.metrics,
    }));
  }
  return { factories, direction };
}
