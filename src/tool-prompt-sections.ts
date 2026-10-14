/** Verified builtin section ownership, not a heuristic from plugin names. */
export const toolPromptSections: Readonly<Record<string, readonly string[]>> = {
  bash: ['tool:bash'], pwsh: ['tool:pwsh'], read: ['tool:read'], write: ['tool:write'], edit: ['tool:edit'],
  glob: ['tool:glob'], grep: ['tool:grep'], job_list: ['tool:jobs'], job_output: ['tool:jobs'], job_kill: ['tool:jobs'],
  web_fetch: ['tool:web_fetch'], web_search: ['tool:web_search'],
  get_goal: ['tool:goal'], create_goal: ['tool:goal'], update_goal: ['tool:goal'],
  workflow: ['tool:workflow'],
};
/** Sections no unhidden tool still uses: a subagent that cannot call the tools should not read their guidance. */
export function sectionsOnlyFor(hidden: readonly string[], kept: readonly string[]): string[] {
  const owned = (names: readonly string[]) => new Set(names.flatMap(name => toolPromptSections[name] ?? []));
  const still = owned(kept);
  return [...owned(hidden)].filter(section => !still.has(section));
}
