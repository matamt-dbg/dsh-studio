import type { GateTasksRead } from '../pixie-gate-definitions.ts';
import type { GateTask } from '../pixie-gate-task.ts';

interface DefinitionSource {
  definitions(): Promise<GateTask[] | GateTasksRead>;
  warn?(message: string): void;
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
