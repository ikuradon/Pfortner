type JsonRecord = Record<string, unknown>;

export interface PlaygroundEvaluationPayload {
  pipeline: unknown;
  message: unknown[];
  direction?: string;
  connectionInfo?: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessageFrom(body: unknown, status: number): string {
  if (
    isRecord(body) && typeof body.error === 'string' && body.error.length > 0
  ) {
    return body.error;
  }
  return `HTTP ${status}`;
}

async function readJson(res: Response): Promise<unknown> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorMessageFrom(body, res.status));
  return body;
}

function sameOriginJsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function fetchAdminConfig(): Promise<unknown> {
  return await readJson(
    await fetch('/admin/api/config', { credentials: 'same-origin' }),
  );
}

export async function fetchAdminPlugins(): Promise<{ plugins: string[] }> {
  const data = await readJson(
    await fetch('/admin/api/plugins', { credentials: 'same-origin' }),
  );
  if (!isRecord(data) || !Array.isArray(data.plugins)) return { plugins: [] };
  return {
    plugins: data.plugins.filter((plugin): plugin is string => typeof plugin === 'string'),
  };
}

export async function fetchPipelineDraft(): Promise<unknown | null> {
  const data = await readJson(
    await fetch('/admin/api/pipeline-draft', { credentials: 'same-origin' }),
  );
  return isRecord(data) ? data.draft ?? null : null;
}

export async function savePipelineDraft(draft: unknown): Promise<unknown> {
  return await readJson(
    await fetch('/admin/api/pipeline-draft', sameOriginJsonPost({ draft })),
  );
}

export async function publishPipelines(pipelines: unknown): Promise<unknown> {
  return await readJson(
    await fetch('/admin/api/pipelines', sameOriginJsonPost({ pipelines })),
  );
}

export async function evaluatePipeline(
  payload: PlaygroundEvaluationPayload,
): Promise<unknown> {
  return await readJson(
    await fetch('/admin/api/playground/evaluate', sameOriginJsonPost(payload)),
  );
}
