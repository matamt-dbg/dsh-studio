import type { PixieMessage } from '../pixie-contracts.ts';

/** Minimal view of a logged session event; payloads are read defensively because they cross a JSON boundary. */
export interface ForkEvent { type: string; seq: number; data: unknown; surfaceOp?: unknown }

interface Node { seq: number; message: PixieMessage | undefined }

const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.filter(block => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string).join('\n').trim();
}

/** Project the surface node a message event contributes; only human prompts and model text survive. */
function project(event: ForkEvent): PixieMessage | undefined {
  const data = event.data as Record<string, unknown> | undefined;
  if (event.type === 'user/message') {
    const source = data?.source as { kind?: unknown } | undefined;
    // Human prompts and compaction summaries carry the conversation; other producers inject context.
    if (source?.kind !== 'user' && source?.kind !== 'compact-checkpoint') return undefined;
    const text = textOf(data?.content);
    return text ? { role: 'user', text } : undefined;
  }
  if (event.type === 'assistant/message') {
    const message = data?.message as { content?: unknown; source?: { provider?: unknown; model?: unknown } } | undefined;
    const text = textOf(message?.content);
    if (!text) return undefined;
    const { provider, model } = message?.source ?? {};
    return typeof provider === 'string' && typeof model === 'string' ? { role: 'assistant', text, provider, model } : { role: 'assistant', text };
  }
  return undefined;
}

/** Fold a session's message events into the text-only conversation Pixie forks.
 * Replays surface replacement (compaction) so a summary stands in for the range it replaced,
 * then keeps user prompts, compaction summaries, and assistant text; system, developer, tool, reasoning, and injected context are dropped.
 */
export function forkSnapshot(events: readonly ForkEvent[]): PixieMessage[] {
  const nodes: Node[] = [];
  for (const event of events) {
    if (!SURFACE.has(event.type)) continue;
    const node: Node = { seq: event.seq, message: project(event) };
    const op = event.surfaceOp as { op?: unknown; startSeq?: unknown; endSeq?: unknown } | undefined;
    if (op && typeof op === 'object' && op.op === 'replace') {
      const start = nodes.findIndex(item => item.seq === op.startSeq);
      const end = nodes.findIndex(item => item.seq === op.endSeq);
      if (start >= 0 && end >= start) { nodes.splice(start, end - start + 1, node); continue; }
    }
    nodes.push(node);
  }
  return nodes.flatMap(node => node.message ? [node.message] : []);
}
