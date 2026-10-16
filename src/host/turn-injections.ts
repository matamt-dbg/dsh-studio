import type { TurnInjection } from '../prompt-composition.ts';

/** Minimal Loader surface: import a package the running DSH already provides. */
export interface ModuleImporter { import(name: string): Promise<unknown>; unwrapExports(value: unknown): unknown }
interface Entry { id: string; name: string; config?: unknown }

const AGENT_INSTRUCTIONS = '@deepseek-ai/dsh-agent-instructions';
const TIME_CONTEXT = '@deepseek-ai/dsh-time-context';
const SKILL_FILESYSTEM = '@deepseek-ai/dsh-skill-filesystem';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * Examples of the per-turn messages the composed plugins add in a real session. Each is produced
 * from the effective Config through the package's public exports or format, here and now; a real
 * session uses its own working directory, time, and skills. Failures become a note, never a throw.
 */
export async function turnInjections(entries: readonly Entry[], loader: ModuleImporter | undefined, options: { cwd: string; now?: Date }): Promise<TurnInjection[]> {
  const result: TurnInjection[] = [];
  for (const entry of entries) {
    if (entry.name === AGENT_INSTRUCTIONS) result.push(await instructions(entry, loader, options.cwd));
    else if (entry.name === TIME_CONTEXT) result.push(timeContext(entry, options.now ?? new Date()));
    else if (entry.name === SKILL_FILESYSTEM) result.push({ entry: entry.id, name: entry.name, note: 'skills' });
  }
  return result;
}

async function instructions(entry: Entry, loader: ModuleImporter | undefined, cwd: string): Promise<TurnInjection> {
  const base = { entry: entry.id, name: entry.name };
  try {
    if (!loader) throw new Error('Loader unavailable');
    const module = record(loader.unwrapExports(await loader.import(AGENT_INSTRUCTIONS)));
    const load = module.loadBaselineInstructions;
    if (typeof load !== 'function') throw new Error('loadBaselineInstructions is not exported by this DSH');
    const config = record(entry.config);
    const rendered = record(await load({ ...config, maxBytes: typeof config.maxBytes === 'number' ? config.maxBytes : 65536, cwd }));
    return typeof rendered.text === 'string' && rendered.text ? { ...base, text: rendered.text } : { ...base, note: 'empty' };
  } catch (error) { return { ...base, note: `error:${error instanceof Error ? error.message : String(error)}` }; }
}

/** Mirrors the time-context message shape (turn 1, step 1, no browser zone) with the configured fallback zone. */
function timeContext(entry: Entry, now: Date): TurnInjection {
  const base = { entry: entry.id, name: entry.name };
  const configured = record(entry.config).timeZone;
  const timeZone = typeof configured === 'string' && configured ? configured : Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' })
      .formatToParts(now).map(part => [part.type, part.value]));
    const offset = String(parts.timeZoneName ?? '').replace(/^GMT/, '') || '+00:00';
    const stamp = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}[${timeZone}]`;
    return { ...base, text: `Time sampled while preparing turn 1, step 1: ${stamp}\nElapsed since the preceding model-visible message: unavailable.` };
  } catch (error) { return { ...base, note: `error:${error instanceof Error ? error.message : String(error)}` }; }
}
