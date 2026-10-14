import { executionDefaultFields, batchLimitFields } from './execution-defaults.ts';
import type { CatalogTool } from './preset-catalog.ts';
export interface WaitCapability { tool: string; parameter: string; minimum?: number; maximum?: number; defaultValue?: number; supported: boolean }
export interface ExecutionCapabilities { waits: WaitCapability[]; batch?: { tool: string; parameter: string; maxItems?: number }; spill: { supported: false; reason: string } }
/** Inspect actual runtime schemas, not a fixed list of builtin tool names. */
export function executionCapabilities(tools: CatalogTool[]): ExecutionCapabilities {
  const waits: WaitCapability[] = [];
  let batch: ExecutionCapabilities['batch'];
  for (const tool of tools) {
    const properties = tool.parameters?.properties as Record<string, Record<string, unknown>> | undefined;
    for (const [parameter, schema] of Object.entries(properties ?? {})) {
      if (['timeoutMs', 'timeout_ms'].includes(parameter) && ['number', 'integer'].includes(String(schema.type))) {
        waits.push({ tool: tool.name, parameter, supported: executionDefaultFields(tool.parameters ?? {}).includes(parameter), ...(typeof schema.minimum === 'number' ? { minimum: schema.minimum } : {}), ...(typeof schema.maximum === 'number' ? { maximum: schema.maximum } : {}), ...(typeof schema.default === 'number' ? { defaultValue: schema.default } : {}) });
      }
      if (batchLimitFields(tool.name, tool.parameters ?? {}).includes(parameter)) batch = { tool: tool.name, parameter, ...(typeof schema.maxItems === 'number' ? { maxItems: schema.maxItems } : {}) };
    }
  }
  return { waits, ...(batch ? { batch } : {}), spill: { supported: false, reason: 'policy-integration-unverified' } };
}
