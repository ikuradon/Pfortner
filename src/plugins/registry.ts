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
import { fromFileUrl, isAbsolute, relative, resolve, toFileUrl } from '@std/path';

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

export interface ExternalPluginSpec {
  name: string;
  url?: string;
  path?: string;
}

function isWithinDirectory(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function resolveExternalPluginSource(spec: ExternalPluginSpec): Promise<string> {
  if (spec.name === '') throw new Error('External plugin name must be non-empty');
  const hasUrl = spec.url != null;
  const hasPath = spec.path != null;
  if (hasUrl === hasPath) throw new Error('External plugin requires exactly one of url or path');
  if (spec.url === '' || spec.path === '') throw new Error('External plugin source must be non-empty');

  let pluginPath: string;
  if (spec.url != null) {
    const url = new URL(spec.url);
    if (url.protocol !== 'file:') throw new Error('External plugin url must use the file: scheme');
    pluginPath = fromFileUrl(url);
  } else {
    pluginPath = resolve(Deno.cwd(), spec.path!);
  }

  const root = await Deno.realPath(Deno.cwd());
  const realPluginPath = await Deno.realPath(pluginPath);
  if (!isWithinDirectory(root, realPluginPath)) {
    throw new Error(`External plugin must be inside the working directory: ${pluginPath}`);
  }

  return toFileUrl(realPluginPath).href;
}

export interface PluginRegistry {
  resolve(name: string): PolicyPlugin;
  register(plugin: PolicyPlugin): void;
  loadExternal(spec: ExternalPluginSpec): Promise<void>;
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
      if (plugins.has(plugin.name)) throw new Error(`Plugin "${plugin.name}" is already registered`);
      plugins.set(plugin.name, plugin);
    },
    async loadExternal(spec: ExternalPluginSpec): Promise<void> {
      if (plugins.has(spec.name)) throw new Error(`Plugin "${spec.name}" is already registered`);
      const source = await resolveExternalPluginSource(spec);

      const mod = await import(source);
      const plugin = mod.default as PolicyPlugin;

      if (!plugin?.name || !plugin?.initialize) {
        throw new Error(`Invalid external plugin from ${source}: must export default with name and initialize`);
      }
      if (plugin.name !== spec.name) {
        throw new Error(`External plugin "${plugin.name}" does not match declared name "${spec.name}"`);
      }
      if (plugins.has(plugin.name)) throw new Error(`Plugin "${plugin.name}" is already registered`);

      plugins.set(plugin.name, plugin);
    },
    listNames(): string[] {
      return [...plugins.keys()];
    },
  };
}
