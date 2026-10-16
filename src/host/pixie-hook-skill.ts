/** Pixie hook rules and guide as an agent skill. The text lives in the release docs; this module reads it at runtime
 * from the installed package (`skills/` is copied there by the build), so docs stay the single source.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BundledSkill } from './skill-install.ts';

/** Files of the skill, from `<package>/skills/studio-pixie-hook-guide/` (build) or the release docs (source/tests). */
export function pixieHookSkill(): BundledSkill {
  const name = 'studio-pixie-hook-guide';
  // Docs live in release/docs here and in docs/ in the published repository.
  const read = (packaged: string, source: string) => {
    for (const candidate of [new URL(packaged, import.meta.url), new URL(source, import.meta.url), new URL(source.replace('release/docs/', 'docs/'), import.meta.url)]) {
      try { return readFileSync(fileURLToPath(candidate), 'utf8'); } catch { /* try the next location */ }
    }
    throw new Error(`Studio skill file missing: ${packaged}`);
  };
  return { name, files: {
    'SKILL.md': read(`./skills/${name}/SKILL.md`, '../../release/docs/appendix/studio-pixie-hook-guide/SKILL.md'),
    'guide.md': read(`./skills/${name}/guide.md`, '../../release/docs/appendix/pixie-gate.md'),
  } };
}
