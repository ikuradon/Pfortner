function isStartNode(node) {
  return node?.type === 'start' || node?.policy === 'start';
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function shouldRenderSettingsAction(node) {
  return Boolean(node) && !isStartNode(node);
}

export function shouldRenderRunAction(node) {
  return isStartNode(node);
}

export function shouldOpenPlaygroundForNode(node) {
  return isStartNode(node);
}

export function parseConfigJson(raw) {
  try {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { config: {} };
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Config JSON must be an object.' };
    }
    return { config: parsed };
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` };
  }
}

export function configToEditorRows(config) {
  return Object.entries(config ?? {}).map(([key, value]) => {
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    return {
      key,
      type,
      value: type === 'array' || type === 'object' ? JSON.stringify(value, null, 2) : value,
    };
  });
}

function parseRowValue(row) {
  if (row.type === 'boolean') return { value: Boolean(row.value) };
  if (row.type === 'number') {
    const n = Number(row.value);
    if (!Number.isFinite(n)) return { error: `${row.key} must be a number.` };
    return { value: n };
  }
  if (row.type === 'array' || row.type === 'object') {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : cloneValue(row.value);
      if (row.type === 'array' && !Array.isArray(parsed)) return { error: `${row.key} must be an array.` };
      if (row.type === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
        return { error: `${row.key} must be an object.` };
      }
      return { value: parsed };
    } catch (e) {
      return { error: `${row.key}: ${e.message}` };
    }
  }
  if (row.type === 'null') return { value: null };
  return { value: String(row.value ?? '') };
}

export function updateConfigFromEditorRows(rows) {
  const config = {};
  for (const row of rows ?? []) {
    if (!row?.key) return { error: 'Config field key is required.' };
    const parsed = parseRowValue(row);
    if ('error' in parsed) return parsed;
    config[row.key] = parsed.value;
  }
  return { config };
}
