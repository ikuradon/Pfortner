import type { PlaygroundEvaluationPayload } from './api_client.ts';
import { evaluatePipeline, fetchPipelineDraft, publishPipelines, savePipelineDraft } from './api_client.ts';
import { graphToPipelines } from './graph.js';
import { buildPipelineDraft, LOCAL_DRAFT_KEY } from './workbench_state.js';
import type { WorkbenchAction, WorkbenchState } from './workbench_reducer.ts';
import { selectWorkbenchDraft, validateWorkbenchGraphsForPublish } from './workbench_reducer.ts';

export interface WorkbenchActionServices {
  fetchPipelineDraft(): Promise<unknown | null>;
  savePipelineDraft(draft: unknown): Promise<unknown>;
  publishPipelines(pipelines: unknown): Promise<unknown>;
  evaluatePipeline(payload: PlaygroundEvaluationPayload): Promise<unknown>;
  readLocalDraft(): unknown | null;
  writeLocalDraft(draft: unknown): boolean;
  now(): number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        stableValue((value as Record<string, unknown>)[key]),
      ]),
    );
  }
  return value;
}

function draftFingerprintFromParts(graphs: unknown, viewports: unknown): string {
  return JSON.stringify(stableValue({ graphs, viewports }));
}

function pipelinesFromResponse(data: unknown, fallback: unknown): unknown {
  return isRecord(data) && isRecord(data.pipelines) ? data.pipelines : fallback;
}

function readLocalDraft(): unknown | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    const raw = globalThis.localStorage.getItem(LOCAL_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalDraft(draft: unknown): boolean {
  try {
    if (typeof globalThis.localStorage === 'undefined') return false;
    globalThis.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function createBrowserWorkbenchActionServices(): WorkbenchActionServices {
  return {
    fetchPipelineDraft,
    savePipelineDraft,
    publishPipelines,
    evaluatePipeline,
    readLocalDraft,
    writeLocalDraft,
    now: () => Date.now(),
  };
}

export async function saveWorkbenchDraft(
  state: WorkbenchState,
  services: WorkbenchActionServices,
  dispatch: (action: WorkbenchAction) => void,
): Promise<void> {
  const draft = buildPipelineDraft({
    graphs: state.graphs,
    viewports: state.viewports,
    publishedFingerprint: state.publishedFingerprint,
    now: services.now(),
  });
  const savedDraftFingerprint = draftFingerprintFromParts(
    state.graphs,
    state.viewports,
  );
  const localSaved = services.writeLocalDraft(draft);

  try {
    await services.savePipelineDraft(draft);
    dispatch({
      type: 'draftSaved',
      message: 'DAG saved',
      kind: 'success',
      savedDraftFingerprint,
    });
  } catch (error) {
    if (localSaved) {
      dispatch({
        type: 'draftSaved',
        message: `DAG saved locally; server draft failed: ${errorMessage(error)}`,
        kind: 'warning',
        savedDraftFingerprint,
      });
      return;
    }
    dispatch({
      type: 'loadFailed',
      message: `DAG save failed: ${errorMessage(error)}`,
    });
  }
}

export async function loadWorkbenchDraft(
  services: WorkbenchActionServices,
  dispatch: (action: WorkbenchAction) => void,
): Promise<void> {
  let draft: unknown | null = null;
  let serverError = '';

  try {
    draft = await services.fetchPipelineDraft();
  } catch (error) {
    serverError = errorMessage(error);
  }

  if (draft === null) {
    draft = services.readLocalDraft();
  }

  if (draft === null) {
    dispatch({
      type: 'loadFailed',
      message: serverError ? `No saved DAG found; server draft failed: ${serverError}` : 'No saved DAG found.',
    });
    return;
  }

  const selectedDraft = selectWorkbenchDraft([draft, services.readLocalDraft()]);
  if ('error' in selectedDraft) {
    dispatch({
      type: 'loadFailed',
      message: `Draft load failed: ${selectedDraft.error}`,
    });
    return;
  }

  dispatch({
    type: 'graphsLoaded',
    graphs: selectedDraft.draft.graphs,
    viewports: selectedDraft.draft.viewports,
    message: 'Loaded saved DAG',
    savedDraftFingerprint: draftFingerprintFromParts(
      selectedDraft.draft.graphs,
      selectedDraft.draft.viewports,
    ),
  });
}

export async function publishWorkbenchGraphs(
  state: WorkbenchState,
  services: WorkbenchActionServices,
  dispatch: (action: WorkbenchAction) => void,
): Promise<void> {
  const validationError = validateWorkbenchGraphsForPublish(state.graphs);
  if (validationError) {
    dispatch({
      type: 'loadFailed',
      message: validationError,
    });
    return;
  }

  const serialized = graphToPipelines(state.graphs);
  try {
    const data = await services.publishPipelines(serialized);
    dispatch({
      type: 'published',
      pipelines: pipelinesFromResponse(data, serialized),
      message: 'Pipeline published',
    });
  } catch (error) {
    dispatch({
      type: 'loadFailed',
      message: `Pipeline publish failed: ${errorMessage(error)}`,
    });
  }
}

export async function runWorkbenchPlayground(
  state: WorkbenchState,
  rawMessage: string,
  services: WorkbenchActionServices,
  dispatch: (action: WorkbenchAction) => void,
): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(rawMessage);
  } catch (error) {
    dispatch({
      type: 'playgroundFailed',
      message: `Invalid JSON: ${errorMessage(error)}`,
    });
    return;
  }

  if (!Array.isArray(message)) {
    dispatch({
      type: 'playgroundFailed',
      message: 'Message must be a JSON array.',
    });
    return;
  }

  const serialized = graphToPipelines(state.graphs);
  try {
    const result = await services.evaluatePipeline({
      pipeline: serialized[state.direction] ?? [],
      message,
      direction: state.direction,
      connectionInfo: {},
    });
    dispatch({ type: 'playgroundResultLoaded', result });
  } catch (error) {
    dispatch({
      type: 'playgroundFailed',
      message: `Playground request failed: ${errorMessage(error)}`,
    });
  }
}
