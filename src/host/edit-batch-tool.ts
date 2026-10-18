/**
 * `edit_batch`: several literal replacements in one file, applied atomically.
 *
 * Every edit is matched against the in-memory result of the previous one; if any edit fails to
 * match (missing or ambiguous), nothing is written. Otherwise the file is written once through
 * the `fs` service's `writeText`, guarded by the same observation policy as the native `edit` tool: the file
 * must have been read in this session and not changed since. Multi-file changes are separate
 * calls (one file per call), so each file commits or fails on its own.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import { z } from 'zod';

/**
 * The public `fs` service members this tool uses, typed locally so the Studio build does not
 * depend on `@deepseek-ai/dsh-fs` type declarations (DSH 0.2.0-rc.2 publishes no such package).
 */
interface FsTarget { readonly displayPath: string }
interface FsService {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>;
  stat(target: FsTarget, signal?: AbortSignal): Promise<{ version: unknown } | undefined>;
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
  writeText(target: FsTarget, content: string, expected?: { kind: 'replaceIfVersion'; version: unknown }, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<{ version: unknown }>;
  processPath(target: FsTarget): string;
}
interface FsEvents {
  waterfall(name: 'fs/edit-intent', target: FsTarget, actor: object, next: () => undefined): Promise<{ version: unknown } | undefined>;
  emit(name: 'fs/observed', target: FsTarget, observation: { kind: 'present'; version: unknown }, actor: object): void;
}
/** DSH 0.2.1 provides `workingDirectory`; 0.2.0-rc.2 resolves against the session header cwd. */
interface WorkingDirectory { ensure(agent: unknown, signal?: AbortSignal): Promise<string> }

export const EDIT_BATCH_TOOL = 'edit_batch';
export const EDIT_BATCH_MAX = 50;

const input = z.object({
  file_path: z.string().trim().min(1),
  edits: z.array(z.object({ old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().optional() }).strict()).min(1).max(EDIT_BATCH_MAX),
}).strict();

export type EditBatchEdit = { old_string: string; new_string: string; replace_all?: boolean | undefined };
export class EditBatchError extends Error { constructor(message: string, readonly code: 'FS_EDIT_NOT_FOUND' | 'FS_AMBIGUOUS_EDIT') { super(message); } }

const lf = (text: string) => text.replaceAll('\r\n', '\n');
const count = (text: string, needle: string) => { let n = 0; for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++; return n; };

/**
 * Apply every edit in order to LF-normalized text. Throws on the first edit that does not match
 * exactly once (or at all, with replace_all), naming its index; nothing is applied in that case.
 */
export function applyEdits(content: string, edits: readonly EditBatchEdit[], displayPath: string): { content: string; replacements: number } {
  let text = lf(content);
  let replacements = 0;
  edits.forEach((edit, index) => {
    const oldString = lf(edit.old_string);
    const n = count(text, oldString);
    if (n === 0) throw new EditBatchError(`edits[${index}].old_string was not found in "${displayPath}" (after applying edits[0..${index - 1}]); no edits were written`, 'FS_EDIT_NOT_FOUND');
    if (n > 1 && !edit.replace_all) throw new EditBatchError(`edits[${index}].old_string matched ${n} times in "${displayPath}"; make it unique or set replace_all; no edits were written`, 'FS_AMBIGUOUS_EDIT');
    text = text.split(oldString).join(lf(edit.new_string));
    replacements += n;
  });
  return { content: text, replacements };
}

/** CRLF-dominant files keep CRLF, matching the native edit's line-ending restoration. */
function restoreLineEndings(original: string, edited: string): string {
  const crlf = original.split('\r\n').length - 1;
  const lfOnly = original.split('\n').length - 1 - crlf;
  return crlf > lfOnly ? edited.replace(/\r?\n/g, '\r\n') : edited;
}

export function installEditBatch(ctx: Context): () => void {
  const tools = ctx.get('tools');
  if (!tools) throw new Error('Studio edit_batch requires tools');
  return tools.register({
    name: EDIT_BATCH_TOOL,
    description: `Apply 1–${EDIT_BATCH_MAX} literal replacements to one UTF-8 file in a single atomic write. Edits apply in order, each against the result of the previous one. If any edit is missing or ambiguous, the file is left unchanged. Read the file first. Use one call per file; prefer this over repeated edit calls on the same file.`,
    parameters: {
      type: 'object', additionalProperties: false, required: ['file_path', 'edits'],
      properties: {
        file_path: { type: 'string', description: 'Path to edit. Provide `file_path` before `edits` in the arguments.' },
        edits: {
          type: 'array', minItems: 1, maxItems: EDIT_BATCH_MAX,
          description: 'Replacements applied in order. Each old_string must match exactly once in the current text unless replace_all is true.',
          items: { type: 'object', additionalProperties: false, required: ['old_string', 'new_string'], properties: {
            old_string: { type: 'string', description: 'Literal text to replace.' },
            new_string: { type: 'string', description: 'Literal replacement text. Use an empty string to delete the match.' },
            replace_all: { type: 'boolean', description: 'Replace all matches. Defaults to false.' },
          } },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string' }, edits: { type: 'number' }, replacements: { type: 'number' },
      } },
      render: (_args: unknown, value: { path: string; edits: number; replacements: number }) => [{ type: 'text', text: `<path>${value.path}</path>\n<type>file</type>\n<content>\nUpdated file (${value.edits} edits, ${value.replacements} replacements)\n</content>` }],
    },
    async execute(raw: unknown, exec: any) {
      const args = input.parse(raw);
      const fs = ctx.get('fs' as never) as unknown as FsService;
      const workingDirectory = ctx.get('workingDirectory' as never) as unknown as WorkingDirectory | undefined;
      const cwd: string | undefined = exec.agent === undefined ? undefined
        : workingDirectory ? await workingDirectory.ensure(exec.agent, exec.signal) : exec.agent.session?.header?.cwd;
      const target = await fs.resolve(args.file_path, { ...(cwd !== undefined ? { cwd } : {}), signal: exec.signal });
      const sandboxPolicy = (ctx.get('sandboxPolicy' as never) as { resolve(input: object): unknown } | undefined)?.resolve({ ...(exec.agent ? { session: exec.agent.session } : {}) });
      // Same guard as the native edit: unread → FS_NOT_OBSERVED, observed version → stale check under the provider lock.
      // fs/edit-intent and fs/observed are declared by the public fs service (0.2.0-rc.2 and later).
      const events = ctx as unknown as FsEvents;
      const intent = await events.waterfall('fs/edit-intent', target, exec, () => undefined);
      // Without the observation policy there is no observed version; take one now so the
      // read→write window is still guarded and a concurrent change fails as FS_STALE_VERSION.
      const version = intent?.version ?? (await fs.stat(target, exec.signal))?.version;
      if (version === undefined) throw new Error(`cannot edit "${target.displayPath}": not found`);
      const original = await fs.readText(target, exec.signal);
      const edited = applyEdits(original, args.edits, target.displayPath);
      const outcome = await fs.writeText(target, restoreLineEndings(original, edited.content),
        { kind: 'replaceIfVersion', version }, exec.signal, sandboxPolicy);
      events.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec);
      return { path: fs.processPath(target), edits: args.edits.length, replacements: edited.replacements };
    },
  } as never);
}

// workingDirectory is read with ctx.get when present: DSH 0.2.0-rc.2 has no such service.
export const inject = ['tools', 'fs'];
export function apply(ctx: Context) { ctx.effect(() => installEditBatch(ctx)); }
