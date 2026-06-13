/** @jsxImportSource preact */
import { configToEditorRows, parseConfigJson, updateConfigFromEditorRows } from './config_editor.js';
import { addMatchCaseDraftConfig, removeMatchCaseDraftConfig } from './node_defaults.ts';
import type { PipelineNode } from './types.ts';

type ConfigValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

type ConfigEditorRow = {
  key: string;
  type: ConfigValueType;
  value: unknown;
};

const CONFIG_VALUE_TYPES: ConfigValueType[] = [
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'null',
];

export function NodeSettingsModal(props: {
  node: PipelineNode;
  mode: 'interactive' | 'json';
  json: string;
  error: string;
  caseIndexMap?: Array<number | null> | null;
  onModeChange(mode: 'interactive' | 'json'): void;
  onJsonChange(value: string, caseIndexMap?: Array<number | null> | null): void;
  onApply(): void;
  onDelete(): void;
  onClose(): void;
}) {
  const parsedConfig = parseConfigJson(props.json);
  const configRows: ConfigEditorRow[] = 'config' in parsedConfig
    ? configToEditorRows(parsedConfig.config) as ConfigEditorRow[]
    : [];
  const interactiveError = props.mode === 'interactive' && 'error' in parsedConfig ? parsedConfig.error : '';
  const shownError = props.error || interactiveError;
  const emitRows = (rows: ConfigEditorRow[]) => {
    const result = updateConfigFromEditorRows(rows);
    if ('config' in result) {
      props.onJsonChange(JSON.stringify(result.config, null, 2), null);
    }
  };
  const emitMatchConfig = (
    next: { config: Record<string, unknown>; caseIndexMap: Array<number | null> },
  ) => {
    props.onJsonChange(JSON.stringify(next.config, null, 2), next.caseIndexMap);
  };

  return (
    <div class='modal-backdrop'>
      <section
        class='workbench-modal node-settings-panel'
        role='dialog'
        aria-modal='true'
        aria-labelledby='node-settings-modal-title'
      >
        <header class='workbench-modal-header'>
          <div>
            <h2 id='node-settings-modal-title'>
              {props.node.policy ?? props.node.id}
            </h2>
            <span class='text-muted'>{props.node.id}</span>
          </div>
          <button
            type='button'
            class='btn btn-ghost btn-icon'
            aria-label='Close node settings'
            onClick={props.onClose}
          >
            X
          </button>
        </header>
        <div class='workbench-modal-body'>
          <div
            class='config-editor-tabs'
            role='group'
            aria-label='Settings mode'
          >
            <button
              type='button'
              class={props.mode === 'interactive' ? 'btn btn-primary' : 'btn btn-ghost'}
              aria-pressed={props.mode === 'interactive'}
              onClick={() => props.onModeChange('interactive')}
            >
              Interactive
            </button>
            <button
              type='button'
              class={props.mode === 'json' ? 'btn btn-primary' : 'btn btn-ghost'}
              aria-pressed={props.mode === 'json'}
              onClick={() => props.onModeChange('json')}
            >
              JSON
            </button>
          </div>
          {props.mode === 'interactive'
            ? (
              <>
                <InteractiveConfigEditor
                  rows={configRows}
                  disabled={Boolean(interactiveError)}
                  onRowsChange={emitRows}
                />
                {'config' in parsedConfig
                  ? (
                    <MatchCaseControls
                      node={props.node}
                      config={parsedConfig.config as Record<string, unknown>}
                      caseIndexMap={props.caseIndexMap}
                      disabled={Boolean(interactiveError)}
                      onChange={emitMatchConfig}
                    />
                  )
                  : null}
              </>
            )
            : (
              <textarea
                class='config-editor-textarea modal-json-editor'
                aria-label='Settings JSON'
                value={props.json}
                onInput={(event) =>
                  props.onJsonChange(
                    (event.currentTarget as HTMLTextAreaElement).value,
                  )}
              />
            )}
          {shownError ? <div class='modal-error' role='alert'>{shownError}</div> : null}
        </div>
        <footer class='workbench-modal-footer'>
          <span class='text-muted'>Node settings</span>
          <div class='modal-footer-actions'>
            <button
              type='button'
              class='btn btn-danger'
              data-modal-action='delete-node'
              onClick={props.onDelete}
            >
              Delete Node
            </button>
            <button type='button' class='btn btn-ghost' onClick={props.onClose}>
              Cancel
            </button>
            <button
              type='button'
              class='btn btn-primary'
              onClick={props.onApply}
            >
              Apply
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function InteractiveConfigEditor(props: {
  rows: ConfigEditorRow[];
  disabled: boolean;
  onRowsChange(rows: ConfigEditorRow[]): void;
}) {
  const updateRow = (
    index: number,
    patch: Partial<ConfigEditorRow>,
  ) => {
    props.onRowsChange(
      props.rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
    );
  };
  const removeRow = (index: number) => {
    props.onRowsChange(props.rows.filter((_, rowIndex) => rowIndex !== index));
  };
  const addRow = () => {
    props.onRowsChange([
      ...props.rows,
      { key: nextFieldKey(props.rows), type: 'string', value: '' },
    ]);
  };

  return (
    <div class='config-editor-rows' aria-label='Interactive settings editor'>
      {props.rows.map((row, index) => (
        <div
          class='config-row'
          data-config-row-key={row.key}
          key={`${row.key}-${index}`}
        >
          <input
            class='form-input'
            aria-label={`Config key ${row.key}`}
            data-config-key-input={row.key}
            disabled={props.disabled}
            value={row.key}
            onInput={(event) =>
              updateRow(index, {
                key: (event.currentTarget as HTMLInputElement).value,
              })}
          />
          <select
            class='form-input'
            aria-label={`Config type ${row.key}`}
            data-config-type={row.key}
            disabled={props.disabled}
            value={row.type}
            onChange={(event) => {
              const type = (event.currentTarget as HTMLSelectElement)
                .value as ConfigValueType;
              updateRow(index, {
                type,
                value: defaultValueForType(type),
              });
            }}
          >
            {CONFIG_VALUE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <ConfigValueField
            row={row}
            disabled={props.disabled}
            onValueChange={(value) => updateRow(index, { value })}
          />
          <button
            type='button'
            class='btn btn-ghost config-row-remove'
            data-config-remove={row.key}
            disabled={props.disabled}
            onClick={() => removeRow(index)}
          >
            Remove
          </button>
        </div>
      ))}
      {props.rows.length === 0 ? <div class='pipeline-empty compact'>No config fields.</div> : null}
      <div class='config-branch-controls'>
        <button
          type='button'
          class='btn btn-ghost'
          data-config-action='add-field'
          disabled={props.disabled}
          onClick={addRow}
        >
          Add Field
        </button>
      </div>
    </div>
  );
}

function ConfigValueField(props: {
  row: ConfigEditorRow;
  disabled: boolean;
  onValueChange(value: unknown): void;
}) {
  const row = props.row;

  if (row.type === 'boolean') {
    return (
      <label class='config-boolean-control'>
        <input
          type='checkbox'
          data-config-field={row.key}
          disabled={props.disabled}
          checked={Boolean(row.value)}
          onInput={(event) =>
            props.onValueChange(
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        <span>{row.value ? 'true' : 'false'}</span>
      </label>
    );
  }

  if (row.type === 'array' || row.type === 'object') {
    return (
      <textarea
        class='form-input config-row-value'
        aria-label={`Config value ${row.key}`}
        data-config-field={row.key}
        disabled={props.disabled}
        value={String(row.value ?? '')}
        onInput={(event) =>
          props.onValueChange(
            (event.currentTarget as HTMLTextAreaElement).value,
          )}
      />
    );
  }

  if (row.type === 'null') {
    return (
      <input
        class='form-input config-row-value'
        aria-label={`Config value ${row.key}`}
        data-config-field={row.key}
        disabled
        value='null'
      />
    );
  }

  return (
    <input
      class='form-input config-row-value'
      type={row.type === 'number' ? 'number' : 'text'}
      aria-label={`Config value ${row.key}`}
      data-config-field={row.key}
      disabled={props.disabled}
      value={String(row.value ?? '')}
      onInput={(event) =>
        props.onValueChange(
          (event.currentTarget as HTMLInputElement).value,
        )}
    />
  );
}

function defaultValueForType(type: ConfigValueType): unknown {
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') return '[]';
  if (type === 'object') return '{}';
  if (type === 'null') return null;
  return '';
}

function nextFieldKey(rows: ConfigEditorRow[]): string {
  const keys = new Set(rows.map((row) => row.key));
  if (!keys.has('field')) return 'field';
  for (let index = 1; index < 1000; index += 1) {
    const key = `field_${index}`;
    if (!keys.has(key)) return key;
  }
  return `field_${Date.now()}`;
}

function MatchCaseControls(props: {
  node: PipelineNode;
  config: Record<string, unknown>;
  caseIndexMap?: Array<number | null> | null;
  disabled: boolean;
  onChange(next: { config: Record<string, unknown>; caseIndexMap: Array<number | null> }): void;
}) {
  if (props.node.policy !== 'match') return null;
  const cases = Array.isArray(props.config.cases) ? props.config.cases : [];
  const caseIndexMap = props.caseIndexMap ?? cases.map((_, index) => index);

  return (
    <div class='config-branch-controls'>
      {cases.map((_, index) => (
        <button
          key={index}
          type='button'
          class='pipeline-entry-btn'
          data-config-action='remove-match-case'
          data-case-index={String(index)}
          disabled={props.disabled}
          onClick={() =>
            props.onChange(
              removeMatchCaseDraftConfig(
                props.config,
                index,
                caseIndexMap,
              ),
            )}
        >
          Remove case {index + 1}
        </button>
      ))}
      <button
        type='button'
        class='btn btn-ghost'
        data-config-action='add-match-case'
        disabled={props.disabled}
        onClick={() =>
          props.onChange(
            addMatchCaseDraftConfig(props.config, caseIndexMap),
          )}
      >
        + Case
      </button>
    </div>
  );
}
