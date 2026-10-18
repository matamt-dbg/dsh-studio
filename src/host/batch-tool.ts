/** Sequential read batching through the ordinary policy pipeline. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { Lifetime } from './tool-lifetime.ts';

/**
 * Register a bounded batch reader; validate every input before dispatching any call.
 * @param maxLines - cap on each nested read's `limit`; `undefined` lets read use its own default
 *   and cap (the dsh-tool-fs `readLimit`/`readMaxBytes`), so `limit` becomes optional.
 */
export function installBatch(ctx: Context, life: Lifetime, goalsDisabled: boolean, maxCalls: number, maxLines: number | undefined): () => void {
  const tools = ctx.get('tools');
  if (!tools) throw new Error('Studio batch reader requires tools');
  const names = goalsDisabled ? ['read', 'grep', 'glob'] : ['read', 'grep', 'glob', 'get_goal'];
  const input = z.object({ calls: z.array(z.object({ name: z.string().refine(name => names.includes(name)), arguments: z.record(z.string(), z.unknown()) }).strict()).min(1).max(maxCalls) }).strict();
  const readRule = maxLines === undefined
    ? 'read takes the same arguments as the read tool; omit limit to read the whole file in one item.'
    : `read requires limit 1–${maxLines}.`;
  return tools.register({
    name: 'read_batch', description: `Run 1–${maxCalls} read-only ${names.join('/')} operations in one call, in order. ${readRule} Stops on the first error. Never use for mutations or polling running jobs.`,
    parameters: { type: 'object', required: ['calls'], additionalProperties: false, properties: { calls: { type: 'array', minItems: 1, maxItems: maxCalls, items: { type: 'object', required: ['name', 'arguments'], additionalProperties: false, properties: { name: { type: 'string', enum: names }, arguments: { type: 'object', additionalProperties: true } } } } } },
    output: { schema: { type: 'array', items: { type: 'object' } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(raw, exec) {
      const { calls } = input.parse(raw);
      if (maxLines !== undefined) for (const call of calls) if (call.name === 'read') z.number().int().min(1).max(maxLines).parse(call.arguments.limit);
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

/**
 * Keep read_batch out of result spilling, the way dsh-spill-policy already exempts `read`.
 * Each nested read is bounded by read's own line/byte caps, so the batch is bounded by
 * `maxCalls` × those caps. A value-replacement decision is one spill-policy passes through; this
 * listener is registered after (inside) spill-policy's prepended one, so it runs first on the way
 * back out and spill-policy sees the replaced value.
 */
export function exemptFromSpill(ctx: Context): () => void {
  return ctx.on('tools/post-execute', async (exec: any, result: any, next: () => Promise<any>) => {
    const decision = await next();
    if (exec.name !== 'read_batch' || decision.kind !== 'accept' || result.isError || Object.hasOwn(decision, 'value') || Object.hasOwn(decision, 'content')) return decision;
    return { ...decision, value: result.value };
  });
}

/** Studio Config: `maxLines` caps each nested read's limit (omit to use read's own default and cap); `noSpill` exempts results from spill-policy. */
export interface Config { maxCalls?: number; maxLines?: number | null; noSpill?: boolean }
import { createLifetime } from "./tool-lifetime.ts";
export const inject = ["tools"];
export function apply(ctx: Context, config: Config = {}) {
  const life = createLifetime();
  // Defaults keep earlier behavior (8 calls, read limit 1–200, spilled like any tool).
  // null (or an explicit undefined) removes the cap so read applies its own default and limit.
  const maxLines = Object.hasOwn(config, 'maxLines') ? (config.maxLines ?? undefined) : 200;
  ctx.effect(() => installBatch(ctx, life, true, config.maxCalls ?? 8, maxLines));
  if (config.noSpill) ctx.effect(() => exemptFromSpill(ctx));
  ctx.effect(() => () => life.dispose());
}
