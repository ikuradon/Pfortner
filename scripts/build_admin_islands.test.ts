import { assertEquals, assertStringIncludes } from '@std/assert';
import { buildAdminClientEntry, buildAdminIslandBundle } from './build_admin_islands.ts';

Deno.test('buildAdminClientEntry writes generated Fresh nav client entry from source', async () => {
  const outDir = await Deno.makeTempDir();
  const outputPath = `${outDir}/fresh_nav.js`;

  try {
    const result = await buildAdminClientEntry({
      entryPoint: new URL('../src/admin/ui/client/fresh_nav.js', import.meta.url),
      outputPath,
    });
    const source = await Deno.readTextFile(outputPath);

    assertEquals(result.outputPath, outputPath);
    assertEquals(
      source.startsWith(
        '// Generated from src/admin/ui/client/fresh_nav.js by scripts/build_admin_islands.ts.\n',
      ),
      true,
    );
    assertStringIncludes(source, 'export function boot');
    assertStringIncludes(source, '../static/islands/PipelineWorkbench.js');
    assertEquals(source.includes('/admin/static/pipelines.js'), false);
    assertEquals(source.includes('PAGE_INITIALIZERS'), false);
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test('buildAdminIslandBundle writes the PipelineWorkbench mount adapter without static controller behavior', async () => {
  const outDir = await Deno.makeTempDir();
  const outputPath = `${outDir}/PipelineWorkbench.js`;

  try {
    const result = await buildAdminIslandBundle({
      entryPoint: new URL('../src/admin/ui/islands/PipelineWorkbench.browser.tsx', import.meta.url),
      outputPath,
      minify: false,
      sourcemap: false,
    });
    const source = await Deno.readTextFile(outputPath);

    assertEquals(result.outputPath, outputPath);
    assertEquals(source.startsWith('// deno-fmt-ignore-file\n'), true);
    assertStringIncludes(source, 'mountPipelineWorkbench');
    assertStringIncludes(source, 'PipelineWorkbenchBrowser');
    assertEquals(source.includes('../pipeline_graph.js'), false);
    assertEquals(source.includes('../pipeline_workbench_state.js'), false);
    assertEquals(source.includes('../pipeline_config_editor.js'), false);
    assertEquals(source.includes('initPipelinesPage'), false);
    assertEquals(source.includes('graphFromRenderedDom'), false);
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});
