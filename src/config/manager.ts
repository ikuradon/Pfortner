import type { InfraContext, PolicyPlugin } from '../plugins/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import { loadConfigFromString, type PfortnerConfig, type ProductionPfortnerConfig } from './loader.ts';
import {
  buildRequestHandler,
  type RequestHandler,
  type RequestHandlerHooks,
  type RequestHandlerOptions,
} from './starter.ts';

type ConfigManagerConfig = PfortnerConfig | ProductionPfortnerConfig;

interface Generation {
  id: number;
  handler: RequestHandler;
  plugins: PolicyPlugin[];
  activeCount: number;
}

interface ConfigManagerOptions<TConfig extends ConfigManagerConfig = PfortnerConfig> {
  loadConfig?: (yamlString: string) => TConfig;
  requestHandlerOptions?: RequestHandlerOptions;
}

export class ConfigManager<TConfig extends ConfigManagerConfig = PfortnerConfig> {
  private currentGen: Generation;
  private oldGens: Generation[] = [];
  private infra: InfraContext;
  private registry: PluginRegistry;
  private hooks?: RequestHandlerHooks;
  private loadConfig: (yamlString: string) => TConfig;
  private requestHandlerOptions?: RequestHandlerOptions;

  private constructor(
    gen: Generation,
    infra: InfraContext,
    registry: PluginRegistry,
    hooks: RequestHandlerHooks | undefined,
    loadConfig: (yamlString: string) => TConfig,
    requestHandlerOptions?: RequestHandlerOptions,
  ) {
    this.currentGen = gen;
    this.infra = infra;
    this.registry = registry;
    this.hooks = hooks;
    this.loadConfig = loadConfig;
    this.requestHandlerOptions = requestHandlerOptions;
  }

  static async create(
    yamlString: string,
    infra: InfraContext,
    registry: PluginRegistry,
    hooks?: RequestHandlerHooks,
  ): Promise<ConfigManager<PfortnerConfig>>;
  static async create<TConfig extends ConfigManagerConfig>(
    yamlString: string,
    infra: InfraContext,
    registry: PluginRegistry,
    hooks: RequestHandlerHooks | undefined,
    options: ConfigManagerOptions<TConfig>,
  ): Promise<ConfigManager<TConfig>>;
  static async create<TConfig extends ConfigManagerConfig = PfortnerConfig>(
    yamlString: string,
    infra: InfraContext,
    registry: PluginRegistry,
    hooks?: RequestHandlerHooks,
    options: ConfigManagerOptions<TConfig> = {},
  ): Promise<ConfigManager<TConfig>> {
    const loadConfig = (options.loadConfig ?? loadConfigFromString) as (yamlString: string) => TConfig;
    const config = loadConfig(yamlString);
    const usedPlugins = ConfigManager.collectPlugins(config, registry);
    const handler = await buildRequestHandler(config, infra, registry, hooks, options.requestHandlerOptions);
    const gen: Generation = { id: 0, handler, plugins: usedPlugins, activeCount: 0 };
    return new ConfigManager<TConfig>(gen, infra, registry, hooks, loadConfig, options.requestHandlerOptions);
  }

  private static collectPlugins(config: ConfigManagerConfig, registry: PluginRegistry): PolicyPlugin[] {
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

  async reload(yamlString: string): Promise<TConfig> {
    const config = this.loadConfig(yamlString);
    const usedPlugins = ConfigManager.collectPlugins(config, this.registry);
    const handler = await buildRequestHandler(
      config,
      this.infra,
      this.registry,
      this.hooks,
      this.requestHandlerOptions,
    );
    const oldGen = this.currentGen;
    this.currentGen = { id: oldGen.id + 1, handler, plugins: usedPlugins, activeCount: 0 };
    if (oldGen.activeCount > 0) {
      this.oldGens.push(oldGen);
    } else {
      this.cleanupGeneration(oldGen);
    }
    return config;
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
