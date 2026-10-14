/** Sequential read batching through the ordinary policy pipeline. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { Lifetime } from './tool-lifetime.ts';

/** Register a bounded batch reader; validate every input before dispatching any call. */
export function installBatch(ctx: Context, life: Lifetime, goalsDisabled: boolean, maxCalls: number, maxLines: number): () => void {
  const tools = ctx.get('tools');
  if (!tools) throw new Error('Studio batch reader requires tools');
  const names = goalsDisabled ? ['read', 'grep', 'glob'] : ['read', 'grep', 'glob', 'get_goal'];
  const input = z.object({ calls: z.array(z.object({ name: z.string().refine(name => names.includes(name)), arguments: z.record(z.string(), z.unknown()) }).strict()).min(1).max(maxCalls) }).strict();
  return tools.register({
    name: 'read_batch', description: `Run 1–${maxCalls} read-only ${names.join('/')} operations in one call, in order. read requires limit 1–${maxLines}. Stops on the first error. Never use for mutations or polling running jobs.`,
    parameters: { type: 'object', required: ['calls'], additionalProperties: false, properties: { calls: { type: 'array', minItems: 1, maxItems: maxCalls, items: { type: 'object', required: ['name', 'arguments'], additionalProperties: false, properties: { name: { type: 'string', enum: names }, arguments: { type: 'object', additionalProperties: true } } } } } },
    output: { schema: { type: 'array', items: { type: 'object' } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(raw, exec) {
      const { calls } = input.parse(raw);
      for (const call of calls) if (call.name === 'read') z.number().int().min(1).max(maxLines).parse(call.arguments.limit);
      return life.run(async ownedSignal => {
        const signal = AbortSignal.any([ownedSignal, exec.signal]);
        const results = [];
        for (const [index, call] of calls.entries()) {
          signal.throwIfAborted();
          const result = await tools.execute({ name: call.name, arguments: call.arguments, ...(exec.agent ? { agent: exec.agent } : {}), signal, callId: ToolCallId(`${exec.callId}:batch:${index}`), rootCallId: exec.rootCallId, parent: exec.token });
          for (const context of result.additionalContexts ?? []) exec.deferContext(context);
          results.push({ name: call.name, isError: result.isError, content: result.content });
          if (result.isError) break;
        }
        return results;
      });
    },
  });
}

import { createLifetime } from "./tool-lifetime.ts";
export const inject = ["tools"];
export function apply(ctx: Context) { const life = createLifetime(); ctx.effect(() => installBatch(ctx, life, true, 8, 200)); ctx.effect(() => () => life.dispose()); }
