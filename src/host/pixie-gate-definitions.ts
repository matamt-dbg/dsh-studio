import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateGateTasks } from '../pixie-gate-task-contracts.ts';
import type { GateTask } from '../pixie-gate-task.ts';

import type { GateTasksRead, GateDefinitionError } from '../pixie-gate-definitions.ts';
export type PresetGate = GateTask;
const diagnostic = (error: unknown, code: string): GateDefinitionError => ({ code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : code, message: error instanceof Error ? error.message : String(error) });
function decode(text: string): GateTasksRead {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { return { entries: [], invalid: [], error: diagnostic(error, 'invalid-json') }; }
  if (!Array.isArray(value)) return { entries: [], invalid: [], error: { code: 'invalid-file', message: 'Gate definitions must be an array' } };
  const result: GateTasksRead = { entries: [], invalid: [] };
  value.forEach((raw, index) => {
    try { if (raw && typeof raw === 'object' && 'definition' in raw) throw Object.assign(new Error('Legacy gate definition is unsupported'), { code: 'legacy-gate-definition' }); const rows = validatePresetGates([...result.entries, raw]); result.entries.push(rows[rows.length - 1]!); }
    catch (error) { result.invalid.push({ index, raw, error: diagnostic(error, 'invalid-entry') }); }
  });
  return result;
}
export const validatePresetGates = validateGateTasks;
/** Atomic, serialized replacement; invalid or failed saves never publish a new definition. */
export class PixieGateDefinitions {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<GateTasksRead> {
    try { return decode(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { entries: [], invalid: [] };
  }
  save(value: unknown): Promise<PresetGate[]> {
    const rows = validatePresetGates(value);
    const operation = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(rows, null, 2), 'utf8');
      await rename(temporary, this.file);
      return structuredClone(rows);
    });
    this.writes = operation;
    return operation;
  }
}
