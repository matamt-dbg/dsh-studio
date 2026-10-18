export interface ExecutionDefaults { defaults: Record<string, Record<string, number>>; batch?: { tool: 'read_batch'; parameter: string; maxItems: number } }

/** Batch limits are opt-in and can only narrow a published array bound. */
export function batchLimitFields(tool: string, parameters: Record<string, unknown>): string[] {
  if (tool !== 'read_batch' || parameters.type !== 'object' || !record(parameters.properties)) return [];
  return Object.entries(parameters.properties).flatMap(([name, schema]) => record(schema) && schema.type === 'array'
    && Number.isSafeInteger(schema.maxItems) && (schema.maxItems as number) > 0
    && (schema.minItems === undefined || (Number.isSafeInteger(schema.minItems) && (schema.minItems as number) >= 0)) ? [name] : []);
}
export function validateBatchLimit(parameters: Record<string, unknown>, batch: NonNullable<ExecutionDefaults['batch']>): void {
  if (!batchLimitFields(batch.tool, parameters).includes(batch.parameter)) throw new Error('Unsupported batch limit');
  const schema = (parameters.properties as Record<string, Record<string, unknown>>)[batch.parameter]!;
  if (!Number.isSafeInteger(batch.maxItems) || batch.maxItems < 1 || batch.maxItems > (schema.maxItems as number) || batch.maxItems < (typeof schema.minItems === 'number' ? schema.minItems : 0)) throw new Error('Batch limit must tighten the published bounds');
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const names = new Set(['timeoutMs', 'timeout_ms']);
const annotations = ['description', 'title', 'default', 'examples'];
const bounds = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];

/** Conservative shared UI/runtime eligibility; no names inferred from a tool's identity. */
export function executionDefaultFields(parameters: Record<string, unknown>): string[] {
  if (parameters.type !== 'object' || !record(parameters.properties)
    || Object.keys(parameters).some(key => !['type', 'properties', 'required', 'additionalProperties', ...annotations].includes(key))
    || (parameters.required !== undefined && (!Array.isArray(parameters.required) || parameters.required.some(key => typeof key !== 'string')))) return [];
  return Object.entries(parameters.properties).flatMap(([name, schema]) => {
    if (!names.has(name) || (parameters.required as string[] | undefined)?.includes(name) || !record(schema)
      || !['number', 'integer'].includes(String(schema.type))
      || Object.keys(schema).some(key => !['type', ...annotations, ...bounds, 'enum', 'const'].includes(key))
      || bounds.some(key => own(schema, key) && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]) || (key === 'multipleOf' && (schema[key] as number) <= 0)))
      || (own(schema, 'const') && (typeof schema.const !== 'number' || !Number.isFinite(schema.const)))
      || (own(schema, 'enum') && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some(value => typeof value !== 'number' || !Number.isFinite(value))))) return [];
    return [name];
  });
}
export function validateExecutionDefaults(value: unknown): asserts value is ExecutionDefaults {
  if (!record(value) || Object.keys(value).some(key => !['defaults', 'batch'].includes(key)) || !record(value.defaults)) throw new Error('Invalid execution defaults');
  if (value.batch !== undefined && (!record(value.batch) || Object.keys(value.batch).some(key => !['tool', 'parameter', 'maxItems'].includes(key)) || value.batch.tool !== 'read_batch' || typeof value.batch.parameter !== 'string' || !value.batch.parameter || ['__proto__', 'prototype', 'constructor'].includes(value.batch.parameter) || !Number.isSafeInteger(value.batch.maxItems) || (value.batch.maxItems as number) < 1)) throw new Error('Invalid batch limit');
  for (const [tool, fields] of Object.entries(value.defaults)) {
    if (!tool || ['__proto__', 'prototype', 'constructor'].includes(tool) || !record(fields)) throw new Error('Invalid execution defaults');
    for (const [field, number] of Object.entries(fields)) if (!names.has(field) || typeof number !== 'number' || !Number.isFinite(number) || number <= 0) throw new Error(`Invalid execution default: ${tool}.${field}`);
  }
}
export function validateExecutionDefault(parameters: Record<string, unknown>, field: string, value: number): void {
  if (!executionDefaultFields(parameters).includes(field)) throw new Error(`Unsupported execution default: ${field}`);
  const schema = (parameters.properties as Record<string, Record<string, unknown>>)[field]!;
  if (!Number.isFinite(value) || value <= 0 || (schema.type === 'integer' && !Number.isInteger(value))
    || (typeof schema.minimum === 'number' && value < schema.minimum)
    || (typeof schema.maximum === 'number' && value > schema.maximum)
    || (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
    || (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
    || (typeof schema.multipleOf === 'number' && !Number.isInteger(value / schema.multipleOf))
    || (Array.isArray(schema.enum) && !schema.enum.includes(value))
    || (own(schema, 'const') && value !== schema.const)) throw new Error(`Execution default outside schema: ${field}`);
}
/**
 * The execution overrides worth saving for a tool selection: defaults of unselected tools, empty
 * per-tool maps and a batch limit for an unselected tool are dropped. Nothing left means no override.
 */
export function selectedExecution(value: ExecutionDefaults | undefined, tools: readonly string[]): ExecutionDefaults | undefined {
  if (!value) return undefined;
  const selected = new Set(tools);
  const defaults = Object.fromEntries(Object.entries(value.defaults).filter(([tool, fields]) => selected.has(tool) && Object.keys(fields).length > 0).map(([tool, fields]) => [tool, { ...fields }]));
  const batch = value.batch && selected.has(value.batch.tool) ? { ...value.batch } : undefined;
  if (!Object.keys(defaults).length && !batch) return undefined;
  return { defaults, ...(batch ? { batch } : {}) };
}
/** Number of execution values a preset overrides (each wait default and the batch limit). */
export function executionOverrideCount(value: ExecutionDefaults | undefined): number {
  if (!value) return 0;
  return Object.values(value.defaults).reduce((sum, fields) => sum + Object.keys(fields).length, 0) + (value.batch ? 1 : 0);
}
/** Only absent own fields receive defaults; explicit null/undefined are left for original validation. */
export function applyExecutionDefaults(args: unknown, defaults: Record<string, number>): unknown {
  if (!record(args)) return args;
  return { ...Object.fromEntries(Object.entries(defaults).filter(([field]) => !own(args, field))), ...args };
}
