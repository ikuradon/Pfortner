export async function reloadConfig(state: {
  configPath?: string;
  reloadFn?: (yamlString: string) => Promise<void>;
}): Promise<{ status: 'reloaded' } | { error: string; status: number }> {
  if (!state.configPath || !state.reloadFn) {
    return { error: 'reload not configured', status: 500 };
  }
  try {
    const content = await Deno.readTextFile(state.configPath);
    await state.reloadFn(content);
    return { status: 'reloaded' };
  } catch (e) {
    return { error: `reload failed: ${(e as Error).message}`, status: 500 };
  }
}
