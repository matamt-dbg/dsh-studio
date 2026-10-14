import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';

// Development contract probe, not evidence of packaged-runtime compatibility.
test('Studio child scope shadows preset sections without mutating originals and restores on disposal', async () => {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  let parent, child;
  const parentKey = {}, childKey = {};
  try {
    await ctx.plugin(Object.assign(inner => {
      parent = createScope(inner, parentKey);
      child = createScope(inner, childKey, { parent: parentKey });
    }, { inject: ['systemPrompt'] }));
    parent.ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: 'Minimal persona', complete: true });
    parent.ctx.systemPrompt.section({ name: 'tool:jobs', order: 10, text: 'Original jobs' });
    child.ctx.systemPrompt.section({ name: 'studio:additional', order: Number.MAX_SAFE_INTEGER, text: 'Studio addition', interpolate: false });
    assert.equal(renderPrompt(await ctx.systemPrompt.assemble({ scope: childKey })), 'Minimal persona');
    const restorePersona = child.ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: 'Studio persona', complete: false });
    const restoreJobs = child.ctx.systemPrompt.section({ name: 'tool:jobs', order: 10, text: 'Edited jobs' });
    const assembly = await ctx.systemPrompt.assemble({ scope: childKey });
    assert.deepEqual(assembly.sections.filter(s => ['deployment:persona-prefix', 'tool:jobs', 'studio:additional'].includes(s.name)).map(s => s.name), ['deployment:persona-prefix', 'tool:jobs', 'studio:additional']);
    assert.equal(assembly.sections.at(-1).name, 'studio:additional');
    assert.match(renderPrompt(assembly), /Studio persona\n\nEdited jobs/);
    assert.ok(renderPrompt(assembly).endsWith('Studio addition'));
    assert.ok(!renderPrompt(assembly).includes('Original jobs'));
    assert.equal(renderPrompt(await ctx.systemPrompt.assemble({ scope: parentKey })), 'Minimal persona');
    assert.throws(() => child.ctx.systemPrompt.section({ name: 'tool:jobs', order: 10, text: 'Duplicate' }), /already registered/);
    restoreJobs();
    assert.match(renderPrompt(await ctx.systemPrompt.assemble({ scope: childKey })), /Original jobs/);
    restorePersona();
    assert.equal(renderPrompt(await ctx.systemPrompt.assemble({ scope: childKey })), 'Minimal persona');
    await child.dispose();
    assert.ok(!(await ctx.systemPrompt.assemble({ scope: childKey })).sections.some(s => s.name === 'studio:additional'));
  } finally {
    await child?.dispose();
    await parent?.dispose();
  }
});
