import type { PreviewRequest } from './prompt-composition.ts';
import { delegationTools } from './delegation.ts';
export const OPTIMIZED_PRESET_ID = 'studio-optimized';
export const BUILTIN_TOOL_PRESETS = ['standard', 'ptc', 'minimal', 'cordis'] as const;
// Goal/Todo, withdrawn task_run, and Cordis introspection/plugin management stay in the Master but not in Optimized.
const excluded = new Set(['get_goal', 'create_goal', 'update_goal', 'todo_write', 'task_run', 'cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager']);
export const OPTIMIZED_PROMPT = `Use glob to discover paths, grep to search contents, and read to inspect files before editing. Prefer targeted edits.
Batch independent read-only inspections with read_batch. Start independent tool calls together; keep calls that depend on earlier results sequential. Do not guess unknown arguments.
Wait for required work to finish before validating it. Use background execution only for independent work or intentionally long-lived services. Do not duplicate running work or busy-poll it.
Track every job you start. Before reporting completion, collect all relevant results and cancel work that no longer matters. Report failures and unverified behavior honestly.
Delegate self-contained independent work when useful and collect the result before relying on it.
Keep changes within the requested scope and preserve user work. Use the smallest sufficient checks for the requested outcome and risk, then stop when the work is complete.`;
export function optimizedTemplate(tools: string[]) {
  const selected = delegationTools(tools.filter(name => !excluded.has(name)));
  const request: PreviewRequest = { preset: 'studio-master', providers: ['@deepseek-ai/dsh-persona'], tools: selected, prompt: OPTIMIZED_PROMPT, model: 'testLLM',
    configOverrides: { 'spill-policy': { maxInlineTokens: 2500 } },
    toolOverrides: {
      ...(selected.includes('bash') ? { bash: { parameters: {
        timeoutMs: 'Foreground wait in milliseconds; defaults to a 600000ms request, subject to the runtime cap. When the next step needs the result, request sufficient waiting initially rather than a short wait followed immediately by polling.',
        run_in_background: 'Run in the background immediately only for concrete independent work or intentionally long-lived services. Collect relevant results before relying on success.',
      } } } : {}),
      ...(selected.includes('job_output') ? { job_output: { parameters: {
        wait: 'Block until completion or the wait expires. Use true when the result is required and no independent work remains; avoid repeated non-blocking checks. Defaults to false.',
        timeout_ms: 'Maximum wait in milliseconds when wait is true. Defaults to a 120000ms request, subject to the runtime cap. Timeout leaves the job running.',
      } } } : {}),
    },
    execution: { defaults: { ...(selected.includes('bash') ? { bash: { timeoutMs: 600000 } } : {}), ...(selected.includes('job_output') ? { job_output: { timeout_ms: 120000 } } : {}) } },
  };
  const missing = ['read_batch'].filter(name => !selected.includes(name));
  return { id: OPTIMIZED_PRESET_ID, name: 'Optimized', description: 'Studio optimized default preset', nonDeletable: true, template: true, status: 'applied' as const, agents: [], request,
    ...(missing.length ? { applyWarning: `Optional tool providers not installed: ${missing.join(', ')}. The preset does not install or emulate these tools.` } : {}) };
}
