/** Task-centred gate (U11–U24): "when → what Pixie does → result". Shared task model for Host and UI drafts. Node-testable. */

/** When a gate runs, in the user's words. Maps to a runtime point (and input source) inside Pixie. */
export type GateWhen = 'user-message' | 'agent-message' | 'tool-before' | 'tool-after' | 'turn-end';
export const GATE_WHENS: readonly GateWhen[] = ['user-message', 'agent-message', 'tool-before', 'tool-after', 'turn-end'];

/** Script directory shown to the user; one entry point per gate (U18–U19). */
export const GATE_SCRIPT_DIR = '<profile>/studio-data/pixie-gate/commands/';

export interface GateTask {
  id: string;
  name: string;
  enabled: boolean;
  when: GateWhen;
  /** What Pixie does, in natural language. The checked text is always given to Pixie; no variables needed. */
  instruction: string;
  advanced: {
    /** File name inside {@link GATE_SCRIPT_DIR}, run before Pixie (U18, U23). */
    script?: string;
    /** Ask the user before a replacement is sent (message points only). */
    confirmReplace: boolean;
    onError: 'pass' | 'block';
    agents: 'root' | 'child' | 'any';
    timeoutMs: number;
    /** Turn end only. */
    maxSteers: number;
  };
  /** Presets the gate is attached to. */
  presetIds: string[];
  /** Attached presets where this gate is switched off; `enabled` stays the gate-wide switch. */
  disabledPresetIds?: string[];
}

export type GateTemplateId = 'format-check' | 'agent-protocol' | 'command-guard' | 'tool-digest' | 'verify-answer';
export interface GateTemplate { id: GateTemplateId; when: GateWhen }

/** One representative template per point (U21); the blank gate comes last. */
export const GATE_TEMPLATES: readonly GateTemplate[] = [
  { id: 'format-check', when: 'user-message' },
  { id: 'agent-protocol', when: 'agent-message' },
  { id: 'command-guard', when: 'tool-before' },
  { id: 'tool-digest', when: 'tool-after' },
  { id: 'verify-answer', when: 'turn-end' },
];

/** Pixie Gate guide: result rules, script contract, environment, helpers, and examples (U22, U23). */
export const GATE_GUIDE_URL = 'https://github.com/matamt-dbg/dsh-studio/blob/main/docs/appendix/pixie-gate.md';

/** Pixie hook script contract (U23), documented in the guide. */
/** 0 runs the Pixie task, 10 skips the gate, 11 applies the script's stdout as the gate output without Pixie. */
export const HOOK_EXIT = { continue: 0, skip: 10, direct: 11 } as const;
export const HOOK_ENV: readonly string[] = ['PIXIE_POINT', 'PIXIE_TOOL_NAME', 'PIXIE_TOOL_ARGS', 'PIXIE_AGENT', 'PIXIE_SESSION_ID', 'PIXIE_TURN', 'PIXIE_GATE_NAME', 'PIXIE_URL', 'PIXIE_TOKEN'];
export const HOOK_HELPERS: readonly string[] = ['pixie ask', 'pixie judge'];

/** On for this preset: switched on, attached, and not switched off for that preset. */
export const enabledFor = (task: GateTask, preset: string) => task.enabled && task.presetIds.includes(preset) && !task.disabledPresetIds?.includes(preset);

/** Points whose message can be replaced or extended before the model reads it. */
export const canReplace = (when: GateWhen) => when === 'user-message' || when === 'agent-message' || when === 'tool-after';
export const isTool = (when: GateWhen) => when === 'tool-before' || when === 'tool-after';
export const isMessage = (when: GateWhen) => when === 'user-message' || when === 'agent-message';

export function makeTask(name: string, when: GateWhen = 'user-message', instruction = ''): GateTask {
  return {
    id: globalThis.crypto.randomUUID(), name, enabled: true, when, instruction,
    advanced: { confirmReplace: false, onError: 'pass', agents: when === 'agent-message' ? 'child' : 'root', timeoutMs: 60000, maxSteers: 1 },
    presetIds: [],
  };
}

/** A gate built from a template; text comes from the caller's locale. */
export function taskFromTemplate(template: GateTemplate, text: { name: string; instruction: string }): GateTask {
  const task = makeTask(text.name, template.when, text.instruction);
  return task;
}

/** Variables the instruction may use: only the prepared script's output. */
export function taskVariables(task: GateTask): string[] {
  const name = task.advanced.script?.replace(/\.[^.]+$/, '');
  return name ? [`{{hooks.${name}.text}}`, `{{hooks.${name}.data}}`] : [];
}

/** @returns the first problem key, or undefined when the draft can be saved. */
export function taskProblem(task: GateTask): 'name' | 'instruction' | 'limits' | undefined {
  if (!task.name.trim()) return 'name';
  // A script may conclude by itself (exit 10/11); it then needs no Pixie task. Exit 0 without one is a run error.
  if (!task.instruction.trim() && task.advanced.script === undefined) return 'instruction';
  if (!(task.advanced.timeoutMs > 0) || !Number.isInteger(task.advanced.maxSteers) || task.advanced.maxSteers < 0) return 'limits';
  return undefined;
}
