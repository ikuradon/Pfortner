const simpleConditionProperties = {
  authenticated: { type: 'boolean' },
  pubkey: { type: 'string' },
  client_ip: { type: 'string' },
  message_type: { enum: ['EVENT', 'REQ', 'CLOSE'] },
  event_kind: { type: 'integer' },
  event_pubkey: { type: 'string' },
  has_search: { type: 'boolean' },
};

const simpleConditionKeys = Object.keys(simpleConditionProperties);

export const conditionSchemaDefinition: Record<string, unknown> = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      properties: simpleConditionProperties,
      additionalProperties: false,
      anyOf: simpleConditionKeys.map((key) => ({ required: [key] })),
    },
    {
      type: 'object',
      properties: {
        and: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/condition' },
        },
      },
      required: ['and'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        or: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/condition' },
        },
      },
      required: ['or'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        not: { $ref: '#/$defs/condition' },
      },
      required: ['not'],
      additionalProperties: false,
    },
  ],
};

export const conditionSchemaRef = { $ref: '#/$defs/condition' };

export function withConditionSchema<T extends Record<string, unknown>>(schema: T): T {
  return {
    ...schema,
    $defs: {
      ...((schema.$defs as Record<string, unknown> | undefined) ?? {}),
      condition: conditionSchemaDefinition,
    },
  };
}
