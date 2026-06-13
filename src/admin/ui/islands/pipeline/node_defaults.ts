type PipelineNode = {
  type?: unknown;
  policy?: unknown;
};

type PipelineConfig = Record<string, unknown>;
type MatchCaseConfig = PipelineConfig & { cases: unknown[] };
type CaseIndexMap = Array<number | null>;

type PipelineEdge = {
  from?: unknown;
  fromPort?: unknown;
};

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isStartNode(node: PipelineNode | null | undefined): boolean {
  return node?.type === 'start' || node?.policy === 'start';
}

export function defaultConfigForPolicy(name: string): PipelineConfig {
  switch (name) {
    case 'accept':
      return {};
    case 'kind-filter':
      return { mode: 'allow', kinds: [1, 3, 6, 7] };
    case 'write-guard':
      return { require_auth: true };
    case 'protected-event':
      return { require_auth: true };
    case 'rate-limit':
      return {
        scope: 'connection',
        window: 60,
        max_events: 60,
        max_requests: 120,
      };
    case 'spam-filter':
      return { max_content_length: 1000 };
    case 'content-filter':
      return { blocked_words: [], blocked_patterns: [] };
    case 'pubkey-acl':
      return { mode: 'blocklist', target: 'author', pubkeys: [] };
    case 'ip-filter':
      return { blocklist: { ips: [], cidrs: [] } };
    case 'when':
      return { condition: { authenticated: true }, then: [], else: [] };
    case 'match':
      return { cases: [{ condition: {}, pipeline: [] }], default: [] };
    case 'route':
      return { upstream: '', condition: { message_type: 'REQ' } };
    default:
      return {};
  }
}

export function shouldRenderInputPort(
  node: PipelineNode | null | undefined,
): boolean {
  return !isStartNode(node);
}

export function isMovablePipelineNode(
  node: PipelineNode | null | undefined,
): boolean {
  return Boolean(node);
}

export function addMatchCaseDraftConfig(
  config: PipelineConfig | null | undefined,
  caseIndexMap: CaseIndexMap | null | undefined,
): { config: MatchCaseConfig; caseIndexMap: CaseIndexMap } {
  const nextConfig = cloneValue(config ?? {}) as MatchCaseConfig;
  const cases = Array.isArray(nextConfig.cases) ? nextConfig.cases : [];
  cases.push({ condition: {}, pipeline: [] });
  nextConfig.cases = cases;
  const nextMap = Array.isArray(caseIndexMap)
    ? [...caseIndexMap, null]
    : cases.map((_, index) => index < cases.length - 1 ? index : null);

  return { config: nextConfig, caseIndexMap: nextMap };
}

export function removeMatchCaseDraftConfig(
  config: PipelineConfig | null | undefined,
  index: number,
  caseIndexMap: CaseIndexMap | null | undefined,
): { config: MatchCaseConfig; caseIndexMap: CaseIndexMap } {
  const nextConfig = cloneValue(config ?? {}) as MatchCaseConfig;
  const previousCases = Array.isArray(config?.cases) ? config.cases : [];
  const cases = Array.isArray(nextConfig.cases) ? nextConfig.cases : [];
  const nextMap = Array.isArray(caseIndexMap) ? [...caseIndexMap] : previousCases.map((_, caseIndex) => caseIndex);

  if (index >= 0 && index < cases.length) {
    cases.splice(index, 1);
    nextMap.splice(index, 1);
  }
  nextConfig.cases = cases;

  return { config: nextConfig, caseIndexMap: nextMap.slice(0, cases.length) };
}

export function reconcileMatchCaseEdges<T extends PipelineEdge>(
  edges: readonly T[] | null | undefined,
  nodeId: string,
  caseIndexMap: readonly (number | null)[] | null | undefined,
  newCaseCount: unknown,
): T[] {
  const count = Math.max(0, Number(newCaseCount) || 0);
  const indexMap = Array.isArray(caseIndexMap) ? caseIndexMap : null;

  return (edges ?? []).flatMap((edge) => {
    const match = /^case:(\d+)$/.exec(String(edge?.fromPort ?? ''));
    if (edge?.from !== nodeId || !match) return [edge];

    const oldIndex = Number(match[1]);
    const newIndex = indexMap ? indexMap.findIndex((mappedIndex) => mappedIndex === oldIndex) : oldIndex;
    if (newIndex < 0 || newIndex >= count) return [];
    if (edge.fromPort === `case:${newIndex}`) return [edge];
    return [{ ...edge, fromPort: `case:${newIndex}` } as T];
  });
}
