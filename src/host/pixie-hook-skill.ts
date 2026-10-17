/** Studio agent skills. The text lives in the release docs; this module reads it at runtime from the installed package
 * (`skills/` is copied there by the build), so docs stay the single source.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BundledSkill } from './skill-install.ts';

/** Files of one skill, from `<package>/skills/<name>/` (build) or the release docs (source/tests). */
function bundledSkill(name: string, guide: string): BundledSkill {
  // Docs live in release/docs here and in docs/ in the published repository.
  const read = (packaged: string, source: string) => {
    for (const candidate of [new URL(packaged, import.meta.url), new URL(source, import.meta.url), new URL(source.replace('release/docs/', 'docs/'), import.meta.url)]) {
      try { return readFileSync(fileURLToPath(candidate), 'utf8'); } catch { /* try the next location */ }
    }
    throw new Error(`Studio skill file missing: ${packaged}`);
  };
  return { name, files: {
    'SKILL.md': read(`./skills/${name}/SKILL.md`, `../../release/docs/appendix/${name}/SKILL.md`),
    'guide.md': read(`./skills/${name}/guide.md`, `../../release/docs/appendix/${guide}`),
  } };
}

/** Pixie Gate hook rules and the Pixie Gate guide. */
export const pixieHookSkill = (): BundledSkill => bundledSkill('studio-pixie-hook-guide', 'pixie-gate.md');
/** `pixie_loop` spec rules and the Pixie Loop guide (#31). */
export const pixieLoopSkill = (): BundledSkill => bundledSkill('studio-pixie-loop-guide', 'pixie-loop.md');

/** SettingsX provider definition guide, from `<package>/skills/studio-provider-guide/` or the release docs. */
export function providerGuideSkill(): BundledSkill {
  const name = 'studio-provider-guide';
  const read = (file: string) => {
    for (const candidate of [new URL(`./skills/${name}/${file}`, import.meta.url), new URL(`../../release/docs/appendix/${name}/${file}`, import.meta.url), new URL(`../../docs/appendix/${name}/${file}`, import.meta.url)]) {
      try { return readFileSync(fileURLToPath(candidate), 'utf8'); } catch { /* try the next location */ }
    }
    throw new Error(`Studio skill file missing: ${name}/${file}`);
  };
  return { name, files: { 'SKILL.md': read('SKILL.md'), 'examples.md': read('examples.md') } };
}
