import { GATE_WHENS, enabledFor, taskProblem, type GateTask } from './pixie-gate-task.ts';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** Shared by storage and Remote boundaries; no Host or Client runtime dependencies. */
export function validateGateTask(value: unknown): GateTask {
  if (!object(value) || !text(value.id) || !text(value.name) || typeof value.enabled !== 'boolean'
    || !GATE_WHENS.includes(value.when as GateTask['when']) || typeof value.instruction !== 'string') throw new Error('Invalid gate task');
  const advanced = value.advanced;
  if (!object(advanced) || typeof advanced.confirmReplace !== 'boolean' || !['pass', 'block'].includes(advanced.onError as string)
    || !['root', 'child', 'any'].includes(advanced.agents as string)
    || typeof advanced.timeoutMs !== 'number' || !Number.isFinite(advanced.timeoutMs)
    || typeof advanced.maxSteers !== 'number') throw new Error('Invalid gate advanced options');
  if (advanced.script !== undefined && (typeof advanced.script !== 'string' || (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(advanced.script) || advanced.script.includes('..')))) throw new Error('Invalid gate script filename');
  // The former judge option was removed (U26); a stored value is ignored and dropped on save.
  if (!Array.isArray(value.presetIds) || !value.presetIds.every(text)) throw new Error('Invalid gate presetIds');
  if (value.disabledPresetIds !== undefined && (!Array.isArray(value.disabledPresetIds) || !value.disabledPresetIds.every(text))) throw new Error('Invalid gate disabledPresetIds');
  const name = typeof advanced.script === 'string' ? advanced.script.replace(/\.[^.]+$/, '') : undefined;
  for (const match of value.instruction.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    if (!name || ![`hooks.${name}.text`, `hooks.${name}.data`].includes(match[1]!)) throw new Error(`Unknown prompt variable: ${match[1]}`);
  }
  const task = structuredClone(value) as unknown as GateTask;
  delete (task.advanced as { judge?: unknown }).judge;
  const problem = taskProblem(task);
  if (problem) throw new Error(`Invalid gate ${problem}`);
  task.presetIds = [...new Set(task.presetIds)];
  // Only attached presets can be switched off; an empty list is not stored.
  const disabled = [...new Set(task.disabledPresetIds ?? [])].filter(id => task.presetIds.includes(id));
  if (disabled.length) task.disabledPresetIds = disabled; else delete task.disabledPresetIds;
  return task;
}

export function validateGateTasks(value: unknown): GateTask[] {
  if (!Array.isArray(value)) throw new Error('Gate tasks must be an array');
  const ids = new Set<string>(), bindings = new Set<string>();
  return value.map(raw => {
    const task = validateGateTask(raw);
    if (ids.has(task.id)) throw new Error('Duplicate gate id');
    ids.add(task.id);
    for (const preset of task.presetIds) {
      const key = JSON.stringify([preset, task.when]);
      if (!enabledFor(task, preset)) continue;
      if (bindings.has(key)) throw new Error('Only one enabled gate per preset and when is supported');
      bindings.add(key);
    }
    return task;
  });
}

export interface GateOutput {
  verdict: 'pass' | 'stop';
  reason?: string;
  replace?: string;
  append?: string;
  note?: string;
}

/** No fences, coercion, unknown fields, or malformed-output fallback. */
export function parseGateOutput(text: string): GateOutput {
  const value: unknown = JSON.parse(text);
  if (!object(value) || (Object.hasOwn(value, 'verdict') && !['pass', 'stop'].includes(value.verdict as string))) throw new Error('Gate output needs a pass/stop verdict');
  for (const [key, field] of Object.entries(value)) {
    if (!['verdict', 'reason', 'replace', 'append', 'note'].includes(key) || typeof field !== 'string') throw new Error(`Invalid gate output field: ${key}`);
  }
  return { verdict: 'pass', ...value } as GateOutput;
}

/** Point-specific forwarding plan. Stop never forwards replacement/addition. */
export function gateOutputPlan(task: GateTask, output: GateOutput, original: string): { stop: boolean; reason?: string; replacement?: string; addition?: string; suggestion?: string; notes: string[] } {
  const message = task.when === 'user-message' || task.when === 'agent-message';
  const mutable = message || task.when === 'tool-after';
  const changed = output.replace !== undefined && output.replace !== original;
  const confirm = message && task.advanced.confirmReplace && changed;
  const stop = output.verdict === 'stop' || confirm;
  const notes = output.note === undefined ? [] : [output.note];
  if (output.replace !== undefined && (!mutable || (stop && !message))) notes.push(output.replace);
  if (output.append !== undefined && (!mutable || stop)) notes.push(output.append);
  return { stop, notes,
    ...(output.reason !== undefined ? { reason: output.reason } : {}),
    ...(stop && message && output.replace !== undefined ? { suggestion: output.replace } : {}),
    ...(!stop && mutable && changed ? { replacement: output.replace } : {}),
    ...(!stop && mutable && output.append !== undefined ? { addition: output.append } : {}),
  };
}
