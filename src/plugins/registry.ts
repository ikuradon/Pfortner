import type { InfraContext, PolicyFactory, PolicyPlugin } from './types.ts';
import type { Policy } from '../pfortner.ts';
import { acceptPolicy } from '../policies/AcceptPolicy.ts';
import { kindFilterPlugin } from '../policies/KindFilterPolicy.ts';
import { writeGuardPlugin } from '../policies/WriteGuardPolicy.ts';
import { protectedEventPlugin } from '../policies/ProtectedEventPolicy.ts';
import { rateLimitPlugin } from '../policies/RateLimitPolicy.ts';
import { spamFilterPlugin } from '../policies/SpamFilterPolicy.ts';
import { contentFilterPlugin } from '../policies/ContentFilterPolicy.ts';
import { pubkeyAclPlugin } from '../policies/PubkeyAclPolicy.ts';
import { ipFilterPlugin } from '../policies/IpFilterPolicy.ts';
import { whenPlugin } from '../policies/WhenPlugin.ts';
import { matchPlugin } from '../policies/MatchPlugin.ts';
import { routePlugin } from '../policies/RoutePlugin.ts';

const acceptPlugin: PolicyPlugin = {
  name: 'accept',
  description: 'Accept all messages (pass-through)',
  direction: 'both',
  configSchema: { type: 'object' },
  initialize(_config: unknown, _infra: InfraContext): Promise<PolicyFactory> {
    return Promise.resolve((_instance) => acceptPolicy as Policy);
  },
};

const BUILTIN_PLUGINS: Map<string, PolicyPlugin> = new Map([
  ['accept', acceptPlugin],
  ['kind-filter', kindFilterPlugin],
  ['write-guard', writeGuardPlugin],
  ['protected-event', protectedEventPlugin],
  ['rate-limit', rateLimitPlugin],
  ['spam-filter', spamFilterPlugin],
  ['content-filter', contentFilterPlugin],
  ['pubkey-acl', pubkeyAclPlugin],
  ['ip-filter', ipFilterPlugin],
  ['when', whenPlugin],
  ['match', matchPlugin],
  ['route', routePlugin],
]);

export interface PluginRegistry {
  resolve(name: string): PolicyPlugin;
  register(plugin: PolicyPlugin): void;
  loadExternal(spec: { url?: string; path?: string }): Promise<void>;
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
    async loadExternal(spec: { url?: string; path?: string }): Promise<void> {
      const source = spec.url ?? spec.path;
      if (!source) throw new Error('External plugin requires url or path');

      const mod = await import(source);
      const plugin = mod.default as PolicyPlugin;

      if (!plugin?.name || !plugin?.initialize) {
        throw new Error(`Invalid external plugin from ${source}: must export default with name and initialize`);
      }

      plugins.set(plugin.name, plugin);
    },
    listNames(): string[] {
      return [...plugins.keys()];
    },
  };
}
