import type { InfraContext, PolicyFactory, PolicyPlugin } from './types.ts';
import type { Policy } from '../pfortner.ts';
import { acceptPolicy } from '../policies/AcceptPolicy.ts';
import { kindFilterPlugin } from '../policies/KindFilterPolicy.ts';
import { writeGuardPlugin } from '../policies/WriteGuardPolicy.ts';
import { protectedEventPlugin } from '../policies/ProtectedEventPolicy.ts';

const acceptPlugin: PolicyPlugin = {
  name: 'accept',
  description: 'Accept all messages (pass-through)',
  direction: 'both',
  configSchema: { type: 'object' },
  async initialize(_config: unknown, _infra: InfraContext): Promise<PolicyFactory> {
    return (_instance) => acceptPolicy as Policy;
  },
};

const BUILTIN_PLUGINS: Map<string, PolicyPlugin> = new Map([
  ['accept', acceptPlugin],
  ['kind-filter', kindFilterPlugin],
  ['write-guard', writeGuardPlugin],
  ['protected-event', protectedEventPlugin],
]);

export interface PluginRegistry {
  resolve(name: string): PolicyPlugin;
  register(plugin: PolicyPlugin): void;
  listNames(): string[];
}

export function createPluginRegistry(): PluginRegistry {
  const plugins = new Map(BUILTIN_PLUGINS);
  return {
    resolve(name: string): PolicyPlugin {
      const plugin = plugins.get(name);
      if (!plugin) throw new Error(`Unknown plugin: "${name}". Available: ${[...plugins.keys()].join(', ')}`);
      return plugin;
    },
    register(plugin: PolicyPlugin): void {
      plugins.set(plugin.name, plugin);
    },
    listNames(): string[] {
      return [...plugins.keys()];
    },
  };
}
