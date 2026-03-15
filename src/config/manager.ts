import type { InfraContext, PolicyPlugin } from '../plugins/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import { loadConfigFromString, type PfortnerConfig } from './loader.ts';
import { buildRequestHandler, type RequestHandler, type RequestHandlerHooks } from './starter.ts';

interface Generation {
  id: number;
  handler: RequestHandler;
  plugins: PolicyPlugin[];
  activeCount: number;
}

export class ConfigManager {
  private currentGen: Generation;
  private oldGens: Generation[] = [];
  private infra: InfraContext;
  private registry: PluginRegistry;
  private hooks?: RequestHandlerHooks;

  private constructor(gen: Generation, infra: InfraContext, registry: PluginRegistry, hooks?: RequestHandlerHooks) {
    this.currentGen = gen;
    this.infra = infra;
    this.registry = registry;
    this.hooks = hooks;
  }

  static async create(
    yamlString: string,
    infra: InfraContext,
    registry: PluginRegistry,
    hooks?: RequestHandlerHooks,
  ): Promise<ConfigManager> {
    const config = loadConfigFromString(yamlString);
    const usedPlugins = ConfigManager.collectPlugins(config, registry);
    const handler = await buildRequestHandler(config, infra, registry, hooks);
    const gen: Generation = { id: 0, handler, plugins: usedPlugins, activeCount: 0 };
    return new ConfigManager(gen, infra, registry, hooks);
  }

  private static collectPlugins(config: PfortnerConfig, registry: PluginRegistry): PolicyPlugin[] {
    const names = new Set<string>();
    for (const entry of [...config.pipelines.client, ...config.pipelines.server]) {
      names.add(entry.policy);
    }
    const plugins: PolicyPlugin[] = [];
    for (const name of names) {
      try {
        plugins.push(registry.resolve(name));
      } catch { /* skip unknown */ }
    }
    return plugins;
  }

  get generation(): number {
    return this.currentGen.id;
  }

  get activeConnections(): number {
    return this.currentGen.activeCount + this.oldGens.reduce((sum, g) => sum + g.activeCount, 0);
  }

  getRequestHandler(): RequestHandler {
    return this.currentGen.handler;
  }

  acquireConnection(): () => void {
    const gen = this.currentGen;
    gen.activeCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      gen.activeCount--;
      if (gen !== this.currentGen && gen.activeCount === 0) {
        this.cleanupGeneration(gen);
      }
    };
  }

  async reload(yamlString: string): Promise<void> {
    const config = loadConfigFromString(yamlString);
    const usedPlugins = ConfigManager.collectPlugins(config, this.registry);
    const handler = await buildRequestHandler(config, this.infra, this.registry, this.hooks);
    const oldGen = this.currentGen;
    this.currentGen = { id: oldGen.id + 1, handler, plugins: usedPlugins, activeCount: 0 };
    if (oldGen.activeCount > 0) {
      this.oldGens.push(oldGen);
    } else {
      this.cleanupGeneration(oldGen);
    }
  }

  private cleanupGeneration(gen: Generation): void {
    this.oldGens = this.oldGens.filter((g) => g !== gen);
    const currentPluginNames = new Set(this.currentGen.plugins.map((p) => p.name));
    for (const plugin of gen.plugins) {
      if (!currentPluginNames.has(plugin.name)) {
        plugin.destroy?.().catch(() => {});
      }
    }
  }
}
