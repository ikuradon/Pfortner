import { assertEquals, assertStringIncludes } from '@std/assert';
import { buildAdminIslandBundle } from './build_admin_islands.ts';

Deno.test('buildAdminIslandBundle writes the PipelineWorkbench mount adapter without static controller behavior', async () => {
  const outDir = await Deno.makeTempDir();
  const outputPath = `${outDir}/PipelineWorkbench.js`;

  try {
    const result = await buildAdminIslandBundle({
      entryPoint: new URL('../admin/islands/PipelineWorkbench.browser.tsx', import.meta.url),
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
