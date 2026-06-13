import type { PlaygroundEvaluationPayload } from './api_client.ts';
import { evaluatePipeline, fetchPipelineDraft, publishPipelines, savePipelineDraft } from './api_client.ts';
import { graphToPipelines, validatePipelineGraph } from './graph.js';
import type { PlaygroundRunRequest } from './types.ts';
import {
  buildPipelineDraft,
  dagFingerprintFromGraphs,
  fingerprintPipelines,
  LOCAL_DRAFT_KEY,
} from './workbench_state.js';
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
  const savedDraftFingerprint = dagFingerprintFromGraphs(state.graphs);
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
  options: { publishedFingerprint?: string } = {},
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

  const selectedDraft = selectWorkbenchDraft(
    [draft, services.readLocalDraft()],
    { publishedFingerprint: options.publishedFingerprint },
  );
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
    savedDraftFingerprint: dagFingerprintFromGraphs(selectedDraft.draft.graphs),
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
    const responsePipelines = pipelinesFromResponse(data, serialized);
    dispatch({
      type: 'published',
      pipelines: responsePipelines,
      message: 'Pipeline published',
    });

    const publishedFingerprint = fingerprintPipelines(responsePipelines);
    const draft = buildPipelineDraft({
      graphs: state.graphs,
      viewports: state.viewports,
      publishedFingerprint,
      now: services.now(),
    });
    const savedDraftFingerprint = dagFingerprintFromGraphs(state.graphs);
    const localSaved = services.writeLocalDraft(draft);
    try {
      await services.savePipelineDraft(draft);
      dispatch({
        type: 'draftSaved',
        message: 'Pipeline published',
        kind: 'success',
        savedDraftFingerprint,
      });
    } catch (saveError) {
      if (localSaved) {
        dispatch({
          type: 'draftSaved',
          message: `Pipeline published; DAG saved locally; server draft failed: ${errorMessage(saveError)}`,
          kind: 'warning',
          savedDraftFingerprint,
        });
        return;
      }
      dispatch({
        type: 'loadFailed',
        message: `Pipeline published; DAG save failed: ${errorMessage(saveError)}`,
      });
    }
  } catch (error) {
    dispatch({
      type: 'loadFailed',
      message: `Pipeline publish failed: ${errorMessage(error)}`,
    });
  }
}

export async function runWorkbenchPlayground(
  state: WorkbenchState,
  request: string | PlaygroundRunRequest,
  services: WorkbenchActionServices,
  dispatch: (action: WorkbenchAction) => void,
): Promise<void> {
  const rawMessage = typeof request === 'string' ? request : request.message;
  const direction = typeof request === 'string' ? state.direction : request.direction;
  const connectionInfo = typeof request === 'string' ? {} : request.connectionInfo;
  const validation = validatePipelineGraph(state.graphs[direction]);
  if (!validation.valid) {
    dispatch({
      type: 'playgroundFailed',
      message: `Graph validation failed: ${validation.errors.map((error) => error.code).join(', ')}`,
    });
    return;
  }

  const trimmedMessage = String(rawMessage ?? '').trim();
  if (!trimmedMessage) {
    dispatch({
      type: 'playgroundFailed',
      message: 'Please enter a message.',
    });
    return;
  }

  let message: unknown;
  try {
    message = JSON.parse(trimmedMessage);
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
      message: 'Message must be a JSON array, e.g. ["EVENT", {...}]',
    });
    return;
  }

  const serialized = graphToPipelines(state.graphs);
  try {
    const result = await services.evaluatePipeline({
      pipeline: serialized[direction] ?? [],
      message,
      direction,
      connectionInfo,
    });
    dispatch({ type: 'playgroundResultLoaded', result });
  } catch (error) {
    dispatch({
      type: 'playgroundFailed',
      message: `Playground request failed: ${errorMessage(error)}`,
    });
  }
}
