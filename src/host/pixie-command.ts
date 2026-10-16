import type { PixieLive } from './pixie-live.ts';

/** Structural slice of the DSH command contract this command needs. */
export interface PixieCommandDefinition {
  name: string;
  description: string;
  input: { hint: string };
  handler: (invocation: { commandId: string; agent: { id: string }; rawInput: string; signal: AbortSignal }) => Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }>;
}

/** `/pixie <question>`: start a Pixie request in the session's active thread.
 * The command log keeps the question line and a status line; the answer streams only to the Pixie tab
 * and is never appended to the session log.
 */
export function pixieCommand(live: PixieLive): PixieCommandDefinition {
  return {
    name: 'pixie',
    description: 'Ask the Pixie side model without adding anything to this conversation',
    input: { hint: '<question>' },
    handler: async ({ commandId, agent, rawInput }) => {
      const question = rawInput.trim();
      if (!question) return { kind: 'error', text: '[pixie/empty] Usage: /pixie <question>' };
      try {
        const { threadId } = await live.start(agent.id, { question, commandId });
        const title = (await live.store.read(agent.id)).threads.find(thread => thread.id === threadId)?.title ?? 'Pixie';
        return { kind: 'success', text: `Asked Pixie · ${title} — the answer is in the Pixie tab` };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
