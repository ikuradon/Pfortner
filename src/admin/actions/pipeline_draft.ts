export interface PipelineWorkbenchDraft {
  version: 1;
  graphs: {
    client: { direction?: string; nodes: unknown[]; edges: unknown[] };
    server: { direction?: string; nodes: unknown[]; edges: unknown[] };
  };
  viewports?: Record<string, unknown>;
  updatedAt: string;
  lastPublishedFingerprint: string;
}

export function pipelineDraftPathForConfig(configPath: string): string {
  return `${configPath}.workbench.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type PipelineWorkbenchGraph = PipelineWorkbenchDraft['graphs']['client'];

function normalizeGraph(
  value: unknown,
  direction: 'client' | 'server',
): { graph: PipelineWorkbenchGraph } | { error: string } {
  if (!isRecord(value)) return { error: `${direction} graph must be an object` };
  if (!Array.isArray(value.nodes)) return { error: `${direction}.nodes must be an array` };
  if (!Array.isArray(value.edges)) return { error: `${direction}.edges must be an array` };
  return {
    graph: {
      direction,
      nodes: structuredClone(value.nodes),
      edges: structuredClone(value.edges),
    },
  };
}

export function normalizePipelineWorkbenchDraft(value: unknown): { draft: PipelineWorkbenchDraft } | { error: string } {
  if (!isRecord(value)) return { error: 'draft object required' };
  if (value.version !== 1) return { error: 'unsupported draft version' };
  if (!isRecord(value.graphs)) return { error: 'draft.graphs object required' };
  const client = normalizeGraph(value.graphs.client, 'client');
  if ('error' in client) return client;
  const server = normalizeGraph(value.graphs.server, 'server');
  if ('error' in server) return server;
  return {
    draft: {
      version: 1,
      graphs: { client: client.graph, server: server.graph },
      viewports: isRecord(value.viewports) ? structuredClone(value.viewports) : {},
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
      lastPublishedFingerprint: typeof value.lastPublishedFingerprint === 'string'
        ? value.lastPublishedFingerprint
        : '',
    },
  };
}

export async function readPipelineWorkbenchDraft(path: string): Promise<PipelineWorkbenchDraft | null> {
  try {
    const raw = await Deno.readTextFile(path);
    const parsed = JSON.parse(raw);
    const normalized = normalizePipelineWorkbenchDraft(parsed);
    if ('error' in normalized) throw new Error(normalized.error);
    return normalized.draft;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

export async function writePipelineWorkbenchDraft(path: string, draft: PipelineWorkbenchDraft): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(draft, null, 2) + '\n');
}
