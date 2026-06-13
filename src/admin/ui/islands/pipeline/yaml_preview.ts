type PipelineEntry = {
  policy?: unknown;
  config?: Record<string, unknown>;
};

type PipelineCollection = {
  client?: PipelineEntry[];
  server?: PipelineEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toYamlValue(val: unknown, indent: string): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (/[:{}\[\],#&*!|>'"%@`]|^\s|\s$|^(true|false|null|~)$/i.test(val)) {
      return JSON.stringify(val);
    }
    return val;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const lines = val.map((v) => indent + '- ' + toYamlValue(v, indent + '  '));
    return '\n' + lines.join('\n');
  }
  if (isRecord(val)) {
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const lines = keys.map((k) => {
      const value = val[k];
      const yv = toYamlValue(value, indent + '  ');
      if (isRecord(value)) {
        return indent + k + ':\n' +
          Object.keys(value).map((sk) =>
            indent + '  ' + sk + ': ' +
            toYamlValue(value[sk], indent + '    ')
          ).join('\n');
      }
      if (Array.isArray(value) && value.length > 0) {
        return indent + k + ':' + yv;
      }
      return indent + k + ': ' + yv;
    });
    return '\n' + lines.join('\n');
  }
  return String(val);
}

function entriesToYaml(
  entries: PipelineEntry[] | undefined,
  indent: string,
): string {
  if (!entries || entries.length === 0) return indent + '  []\n';
  let out = '';
  for (const entry of entries) {
    out += indent + '- policy: ' + entry.policy + '\n';
    if (entry.config && Object.keys(entry.config).length > 0) {
      out += indent + '  config:\n';
      for (const [k, v] of Object.entries(entry.config)) {
        const yv = toYamlValue(v, indent + '      ');
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
          out += indent + '    ' + k + ':' + yv + '\n';
        } else if (isRecord(v)) {
          out += indent + '    ' + k + ':' + yv + '\n';
        } else {
          out += indent + '    ' + k + ': ' + yv + '\n';
        }
      }
    }
  }
  return out;
}

export function buildYamlPreview(pipes: PipelineCollection): string {
  let yaml = 'pipelines:\n';
  yaml += '  client:\n' + entriesToYaml(pipes.client, '  ');
  yaml += '  server:\n' + entriesToYaml(pipes.server, '  ');
  return yaml;
}

export function buildPublishConfirmationMessage(yaml: string): string {
  return 'Publish this pipeline configuration to the active config file?\n\n' +
    yaml;
}
