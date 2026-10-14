import type { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import { renderPrompt, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt';
import { randomUUID } from 'node:crypto';
import { type PreviewRequest, type PreviewResult } from '../prompt-composition.ts';
import { compositionPlan, parseComposition } from './composition-plan.ts';
import { installPolicy } from './preset-policy.ts';
import { delegationTools } from '../delegation.ts';
export { parseComposition };
export { promptProviders } from '../prompt-composition.ts';

/** Real assembly in a disposable child scope; same plan and policy used by exported presets. */
export async function assemblePreview(ctx: Context, input: PreviewRequest): Promise<PreviewResult> {
  // Preview the same tool surface that apply registers: generic delegation folds into subagent_role.
  const { request, plugins } = await compositionPlan(ctx, { ...input, tools: delegationTools(input.tools) });
  const id = `studio-preview-${randomUUID()}`;
  const unregister = await ctx.agentPresets.register({ id, plugins: plugins as never });
  try {
    if (ctx.agentPresets.resolve) {
      const resolved = await ctx.agentPresets.resolve(id);
      if (resolved.broken) throw new Error(resolved.broken);
    }
    const lease = await ctx.agentPresets.acquireScope(id);
    try {
      const key = {};
      const child = createScope(ctx, key, { parent: lease.key });
      try {
        installPolicy(child.ctx, key, { tools: request.tools, toolOverrides: request.toolOverrides ?? {}, sections: request.sections ?? {}, prompt: request.prompt, ...(request.execution ? { execution: request.execution } : {}) });
        child.ctx.systemPrompt.variable('cwd', () => process.cwd());
        if (request.model.trim()) child.ctx.systemPrompt.variable('model', () => request.model.trim());
        const assembly = await ctx.systemPrompt.assemble({ scope: key });
        const actual = assembly.tools.map(tool => tool.name);
        if (actual.some(name => !request.tools.includes(name)) || request.tools.some(name => !actual.includes(name))) throw new Error('Assembler tool output differs from the selected tools');
        return {
          prompt: renderPrompt(assembly),
          sections: assembly.sections.map(section => ({ name: section.name, text: renderPrompt({ ...assembly, sections: [section] }) })).filter(section => section.text),
          context: renderContextSnapshot(assembly), tools: assembly.tools,
        };
      } finally { await child.dispose(); }
    } finally { await lease[Symbol.asyncDispose](); }
  } finally { await unregister(); }
}
