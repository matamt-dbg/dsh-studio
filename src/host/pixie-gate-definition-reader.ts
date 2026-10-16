import type { GateTasksRead } from '../pixie-gate-definitions.ts';
import type { GateTask } from '../pixie-gate-task.ts';

interface DefinitionSource {
  definitions(): Promise<GateTask[] | GateTasksRead>;
  warn?(message: string): void;
  /** Gate ids switched off for this session only. A failed read keeps every gate on: it never silences a gate. */
  disabledGates?(sessionId: string): Promise<readonly string[]>;
}
const warnings = new WeakMap<DefinitionSource, { key: string; time: number }>();
/** Definition failures are configuration errors, never a reason to fail an agent turn. */
export async function readRuntimeGateDefinitions(source: DefinitionSource): Promise<GateTask[]> {
  const warn = (key: string) => {
    const previous = warnings.get(source), time = Date.now();
    if (previous?.key === key && time - previous.time < 60_000) return;
    warnings.set(source, { key, time });
    source.warn?.(`studio pixie: gate definitions skipped: ${key}`);
  };
  try {
    const result = await source.definitions();
    if (Array.isArray(result)) return result;
    if (result.error || result.invalid.length) warn(JSON.stringify({ error: result.error, invalid: result.invalid.map(({ index, error }) => ({ index, error })) }));
    return result.error ? [] : result.entries;
  } catch (error) {
    warn(String(error));
    return [];
  }
}

/** Runtime definitions for one session: session-disabled gates are removed before any point matches. */
export async function readSessionGateDefinitions(source: DefinitionSource, sessionId: string): Promise<GateTask[]> {
  const [rows, disabled] = await Promise.all([readRuntimeGateDefinitions(source), source.disabledGates?.(sessionId).catch(error => {
    source.warn?.(`studio pixie: session gate switches unreadable for ${sessionId}: ${String(error)}`);
    return [] as readonly string[];
  }) ?? Promise.resolve([] as readonly string[])]);
  if (!disabled.length) return rows;
  const off = new Set(disabled);
  return rows.filter(row => !off.has(row.id));
}
