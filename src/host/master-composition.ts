import type { CompositionRow } from '../prompt-composition.ts';
import { BATCH_PLUGIN, ROLE_PLUGIN } from '../package-name.ts';
const plugin = (id: string, config?: Record<string, unknown>, suffix = id): CompositionRow => ({ id, name: `@deepseek-ai/dsh-${suffix}`, ...(config ? { config } : {}) });
/** Explicit supported baseline. No dependency on mutable user preset declarations. */
export function masterComposition(): CompositionRow[] {
  return [
    plugin('persona', { prefix: 'You are a coding agent powered by the {{model}} model.' }),
    plugin('agent-instructions', { maxBytes: 65536 }), plugin('time-context'),
    plugin(process.platform === 'win32' ? 'tool-pwsh' : 'tool-bash'),
    plugin('spill-policy'),
    { id: 'studio-batch', name: BATCH_PLUGIN },
    // task_run (the /tasks entry) is withheld from the Master for now; the provider stays packaged.
    plugin('tool-fs'), plugin('tool-fs-search', { sampleOverCapGlobResults: false }),
    plugin('tool-jobs'), plugin('skill-filesystem'), plugin('tool-skill'),
    plugin('command-goal'), plugin('tool-goal'),
    { id: 'planning', name: 'cordis:group', group: true, isolate: { planMode: true }, config: [plugin('plan-mode', { section: 'You are in plan mode. Explore with read-only operations and present a complete plan using exit_plan_mode. Do not modify files, execute mutations, or leave plan mode until the user approves the plan or switches modes.' })] },
    { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [plugin('compaction-basic'), plugin('command-compact'), plugin('tool-result-pruner', { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }, 'compaction-tool-result-pruner')] },
    { id: 'delegation', name: 'cordis:group', group: true, isolate: { workflowEngine: true }, config: [
      plugin('tool-subagent-control'), plugin('tool-subagent-list-agents', undefined, 'tool-subagent-control/list-agents'),
      plugin('tool-subagent', { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true, toolFilter: { deny: ['schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update'] } }),
      plugin('tool-subagent-fork', { provider: 'fork', toolName: 'subagent_fork', toolFilter: { deny: ['schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update'] } }, 'tool-subagent'),
      plugin('workflow-ptc', { provider: 'spawn' }), plugin('tool-workflow'),
      // Catalog source for subagent_role; Studio presets replace the generic subagent tools above with it.
      { id: 'studio-master-roles', name: ROLE_PLUGIN, config: { roles: [] } },
    ] },
    plugin('tool-ask-user'), plugin('tool-todo', { allowParallelInProgress: true }),
    plugin('tool-web', { fetch: true, searchTimeoutMs: 60000 }), plugin('tool-present'),
    plugin('tool-cordis'), plugin('tool-plugin-manager', undefined, 'plugin-manager/tools'),
  ];
}
