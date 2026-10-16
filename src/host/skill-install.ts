/** Install Studio's bundled agent skills into `<DSH home>/skills`, which DSH's filesystem skill provider reads. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One skill: its directory name and files (relative path → content). */
export interface BundledSkill { name: string; files: Record<string, string> }
/** Per-file outcome: written, already current, or left alone because the user changed it. */
export type SkillFileResult = 'installed' | 'current' | 'kept-user-edit';

const MARKER = 'studio-managed';
const MANIFEST = '.studio-managed.json';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Write each file unless the user edited it. A file counts as Studio-managed when its current digest matches the
 * digest Studio recorded at the last install; an absent file is installed. Writes are atomic (temp + rename).
 * @returns the outcome per relative path.
 */
export async function installSkill(skillsRoot: string, skill: BundledSkill): Promise<Record<string, SkillFileResult>> {
  const directory = join(skillsRoot, skill.name);
  await mkdir(directory, { recursive: true });
  const manifestPath = join(directory, MANIFEST);
  let recorded: Record<string, string> = {};
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as { kind?: unknown; files?: unknown };
    if (parsed.kind === MARKER && parsed.files && typeof parsed.files === 'object') recorded = parsed.files as Record<string, string>;
  } catch { /* No manifest: every existing file is treated as the user's. */ }
  const results: Record<string, SkillFileResult> = {};
  const next: Record<string, string> = {};
  for (const [relative, content] of Object.entries(skill.files)) {
    const path = join(directory, relative);
    const wanted = digest(content);
    let current: string | undefined;
    try { current = digest(await readFile(path, 'utf8')); } catch { current = undefined; }
    if (current === wanted) { results[relative] = 'current'; next[relative] = wanted; continue; }
    if (current !== undefined && current !== recorded[relative]) { results[relative] = 'kept-user-edit'; continue; }
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, path);
    results[relative] = 'installed';
    next[relative] = wanted;
  }
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ kind: MARKER, files: next }, null, 2)}\n`);
  await rename(temporary, manifestPath);
  return results;
}
