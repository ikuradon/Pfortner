import * as esbuild from 'esbuild';
import { dirname, fromFileUrl } from '@std/path';

const DEFAULT_PIPELINE_WORKBENCH_ENTRY = new URL('../admin/islands/PipelineWorkbench.browser.tsx', import.meta.url);
const DEFAULT_PIPELINE_WORKBENCH_OUTPUT = new URL('../admin/static/islands/PipelineWorkbench.js', import.meta.url);

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

if (import.meta.main) {
  const result = await buildAdminIslandBundle();
  console.log(`Built ${result.outputPath}`);
}
