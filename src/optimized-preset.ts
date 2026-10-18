import type { PreviewRequest } from './prompt-composition.ts';
import { delegationTools, GENERIC_DELEGATION_TOOLS, LEGACY_ROLE_TOOL, ROLE_TOOL } from './delegation.ts';
import type { StudioRole } from './role-settings.ts';
export const OPTIMIZED_PRESET_ID = 'studio-optimized';
export const BUILTIN_TOOL_PRESETS = ['standard', 'ptc', 'minimal', 'cordis'] as const;
/**
 * The everyday tool surface Optimized ships with, and the only tools it selects.
 *
 * A fixed starting selection, not "everything except a few": a profile plugin that registers an
 * extra tool (x_search, image_generate, ...) does not enlarge this saved selection. It is not a
 * runtime allowlist either: tools a provider registers after the Agent starts follow DSH's normal
 * flow (see installPolicy). Generic and legacy subagent names stay allowed so
 * {@link delegationTools} can fold them into `subagent_role`.
 *
 * The main agent keeps orchestration tools (delegation, judge, pixie_loop, inspection); the
 * default Worker role hides them through its Tool Filter ({@link WORKER_HIDDEN_TOOLS}).
 */
export const OPTIMIZED_TOOLS: readonly string[] = [
  'read_batch', 'read', 'write', 'edit', 'edit_batch', 'glob', 'grep',
  'job_output', 'job_list', 'job_kill', 'skill', 'ask_user_question',
  'web_search', 'web_fetch', 'present',
  'bash', 'read_image', 'exit_plan_mode',
  'send_message', 'interrupt_agent', 'list_agents', 'workflow', 'subagent_role',
  'judge', 'pixie_loop', 'cordis_inspect_list', 'cordis_inspect_query',
];
const ALLOWED_TOOLS = new Set<string>([...OPTIMIZED_TOOLS, ...GENERIC_DELEGATION_TOOLS, LEGACY_ROLE_TOOL]);
/** Studio tools Optimized expects; a template without them warns instead of emulating them. */
const OPTIONAL_TOOLS = ['read_batch', 'edit_batch', 'judge', 'pixie_loop'];

/** Common instructions measured on TB4 (RD) plus the large-output and delegation lines. */
export const OPTIMIZED_PROMPT = `Read whole files in one call; use offset/limit only past the read cap. Read several files with one read_batch. Do not re-read a file you already have.
For logs, generated files and large data dumps, grep for the relevant lines first and read only those ranges.
Send independent calls in one response; sequence only on a real dependency. Combine related checks into one bash command.
Apply all changes to one file in one edit_batch.
Long commands continue as background jobs; collect them with job_output instead of rerunning. Before finishing, collect or kill every job you started.
Delegate self-contained independent work when useful and collect the result before relying on it.
Stay within the requested scope. Verify the result once with the smallest sufficient check, report failures honestly, then stop.`;

/** Drop the sentences that name a Studio batch tool the template could not select. */
export function optimizedPrompt(tools: readonly string[]): string {
  let prompt = OPTIMIZED_PROMPT;
  if (!tools.includes('read_batch')) prompt = prompt.replace(' Read several files with one read_batch.', '');
  if (!tools.includes('edit_batch')) prompt = prompt.replace('Apply all changes to one file in one edit_batch.\n', '');
  return prompt;
}

/** Tools the default Worker does not get: the main agent keeps them for orchestration. */
export const WORKER_HIDDEN_TOOLS: readonly string[] = [
  'send_message', 'interrupt_agent', 'list_agents', 'workflow', 'ask_user_question', 'exit_plan_mode', 'present',
  'judge', 'pixie_loop', 'cordis_inspect_list', 'cordis_inspect_query',
];
export const WORKER_PERSONA = 'No user is available to answer questions; do not ask for confirmation. Do the work yourself; do not delegate. Work until the task is complete and verified, then report the result, changed files and checks briefly.';

/** The default Worker. Its Tool Filter names only selected tools, because apply rejects any other. */
export function optimizedAgents(tools: readonly string[]): StudioRole[] {
  if (!tools.includes(ROLE_TOOL)) return [];
  return [{ name: 'Worker', role: 'worker', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: WORKER_PERSONA,
    toolFilter: { mode: 'replace', deny: WORKER_HIDDEN_TOOLS.filter(name => tools.includes(name)) } }];
}

const GOAL_TOOLS = ['create_goal', 'get_goal', 'update_goal'];
const BASH_TIMEOUT_MS = 120000;
const JOB_OUTPUT_TIMEOUT_MS = 120000;

export function optimizedTemplate(tools: string[]) {
  const selected = delegationTools(tools.filter(name => ALLOWED_TOOLS.has(name)));
  const has = (name: string) => selected.includes(name);
  const request: PreviewRequest = { preset: 'studio-master', providers: ['@deepseek-ai/dsh-persona'], tools: selected, prompt: optimizedPrompt(selected), model: 'testLLM',
    // studio-batch provides read_batch; its Config exists only where the tool does.
    configOverrides: { 'spill-policy': { maxInlineTokens: 2500 }, ...(has('read_batch') ? { 'studio-batch': { maxLines: null, noSpill: true } } : {}) },
    toolOverrides: {
      ...(has('bash') ? { bash: { parameters: {
        timeoutMs: `Foreground wait in milliseconds; defaults to ${BASH_TIMEOUT_MS}ms, subject to the runtime cap. A command that runs longer keeps running as a background job; collect it with job_output instead of rerunning it.`,
        run_in_background: 'Use for builds, tests, or scripts expected to take longer than a minute; continue other work and collect the result with job_output.',
      } } } : {}),
      ...(has('read') ? { read: { parameters: {
        limit: 'Maximum lines to return. Omit to read the whole file (up to 2000 lines).',
        offset: '1-based first line. Use only to continue a file longer than the read cap.',
      } } } : {}),
      ...(has('job_output') ? { job_output: { parameters: {
        wait: 'Block until completion or the wait expires. Use true when the result is required and no independent work remains; avoid repeated non-blocking checks. Defaults to false.',
        timeout_ms: `Maximum wait in milliseconds when wait is true. Defaults to a ${JOB_OUTPUT_TIMEOUT_MS}ms request, subject to the runtime cap. Timeout leaves the job running.`,
      } } } : {}),
    },
    sections: {
      ...(has('read') ? { 'tool:read': 'Use read, not cat, for text files. One read returns up to 2000 lines; omit limit unless a file is larger.' } : {}),
      // DSH renders goal guidance whether or not a goal tool is offered; Optimized offers none.
      ...(GOAL_TOOLS.some(has) ? {} : { 'tool:goal': '' }),
    },
    execution: { defaults: { ...(has('bash') ? { bash: { timeoutMs: BASH_TIMEOUT_MS } } : {}), ...(has('job_output') ? { job_output: { timeout_ms: JOB_OUTPUT_TIMEOUT_MS } } : {}) } },
  };
  const missing = OPTIONAL_TOOLS.filter(name => !has(name));
  return { id: OPTIMIZED_PRESET_ID, name: 'Optimized', description: 'Studio optimized default preset', nonDeletable: true, template: true, status: 'applied' as const, agents: optimizedAgents(selected), request,
    ...(missing.length ? { applyWarning: `Optional tool providers not installed: ${missing.join(', ')}. The preset does not install or emulate these tools.` } : {}) };
}
