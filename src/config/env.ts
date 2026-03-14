const ENV_PATTERN = /\$\{([^}]+)\}/g;

function expandString(value: string): string {
  return value.replace(ENV_PATTERN, (_match, varName) => Deno.env.get(varName) ?? '');
}

export function expandEnvVars(obj: any): any {
  if (typeof obj === 'string') return expandString(obj);
  if (Array.isArray(obj)) return obj.map(expandEnvVars);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}
