import * as esbuild from 'esbuild';
import { dirname, fromFileUrl } from '@std/path';

const DEFAULT_ADMIN_CLIENT_ENTRY_SOURCE = new URL('../admin/client/fresh_nav.js', import.meta.url);
const DEFAULT_ADMIN_CLIENT_ENTRY_OUTPUT = new URL('../admin/static/fresh_nav.js', import.meta.url);
const DEFAULT_PIPELINE_WORKBENCH_ENTRY = new URL('../admin/islands/PipelineWorkbench.browser.tsx', import.meta.url);
const DEFAULT_PIPELINE_WORKBENCH_OUTPUT = new URL('../admin/static/islands/PipelineWorkbench.js', import.meta.url);
const GENERATED_ADMIN_CLIENT_ENTRY_BANNER =
  '// Generated from admin/client/fresh_nav.js by scripts/build_admin_islands.ts.\n';

const DENO_RESOLVED_BROWSER_IMPORTS = new Set([
  'preact',
  'preact/hooks',
  'preact/jsx-runtime',
]);

export interface AdminIslandBundleOptions {
  entryPoint?: string | URL;
  outputPath?: string | URL;
  minify?: boolean;
  sourcemap?: boolean;
}

export interface AdminIslandBundleResult {
  entryPoint: string;
  outputPath: string;
}

export interface AdminClientEntryBuildOptions {
  entryPoint?: string | URL;
  outputPath?: string | URL;
}

export interface AdminClientEntryBuildResult {
  entryPoint: string;
  outputPath: string;
}

export interface AdminBrowserAssetsBuildResult {
  clientEntry: AdminClientEntryBuildResult;
  pipelineWorkbench: AdminIslandBundleResult;
}

function pathFromFile(value: string | URL): string {
  return value instanceof URL ? fromFileUrl(value) : value;
}

function denoResolvedBrowserImportsPlugin(): esbuild.Plugin {
  return {
    name: 'deno-resolved-browser-imports',
    setup(build) {
      build.onResolve({ filter: /^[^./].*/ }, (args) => {
        if (!DENO_RESOLVED_BROWSER_IMPORTS.has(args.path)) return null;
        const resolved = import.meta.resolve(args.path);
        if (!resolved.startsWith('file:')) {
          return { path: resolved, external: true };
        }
        return { path: fromFileUrl(resolved) };
      });
    },
  };
}

export async function buildAdminClientEntry(
  options: AdminClientEntryBuildOptions = {},
): Promise<AdminClientEntryBuildResult> {
  const entryPoint = pathFromFile(options.entryPoint ?? DEFAULT_ADMIN_CLIENT_ENTRY_SOURCE);
  const outputPath = pathFromFile(options.outputPath ?? DEFAULT_ADMIN_CLIENT_ENTRY_OUTPUT);
  const source = await Deno.readTextFile(entryPoint);

  await Deno.mkdir(dirname(outputPath), { recursive: true });
  await Deno.writeTextFile(outputPath, GENERATED_ADMIN_CLIENT_ENTRY_BANNER + source);

  return { entryPoint, outputPath };
}

export async function buildAdminIslandBundle(
  options: AdminIslandBundleOptions = {},
): Promise<AdminIslandBundleResult> {
  const entryPoint = pathFromFile(options.entryPoint ?? DEFAULT_PIPELINE_WORKBENCH_ENTRY);
  const outputPath = pathFromFile(options.outputPath ?? DEFAULT_PIPELINE_WORKBENCH_OUTPUT);

  await Deno.mkdir(dirname(outputPath), { recursive: true });
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: outputPath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ?? false,
    banner: {
      js: '// deno-fmt-ignore-file',
    },
    plugins: [denoResolvedBrowserImportsPlugin()],
  });

  return { entryPoint, outputPath };
}

export async function buildAdminBrowserAssets(): Promise<AdminBrowserAssetsBuildResult> {
  const clientEntry = await buildAdminClientEntry();
  const pipelineWorkbench = await buildAdminIslandBundle();
  return { clientEntry, pipelineWorkbench };
}

if (import.meta.main) {
  const result = await buildAdminBrowserAssets();
  console.log(`Built ${result.clientEntry.outputPath}`);
  console.log(`Built ${result.pipelineWorkbench.outputPath}`);
}
