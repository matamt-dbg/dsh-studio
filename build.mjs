import { build, context } from 'esbuild';
const watch = process.argv.includes('--watch');
async function compile(options) {
  if (!watch) return build(options);
  const builder = await context(options);
  await builder.watch();
}
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('.', import.meta.url));
// The client module id must equal the installed package name so DSH can match its dsh.client declaration.
const packageName = JSON.parse(readFileSync(new URL('packages/shell/package.json', import.meta.url), 'utf8')).name;
await compile({
  absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: ['src/host/preset-policy.ts'], outfile: 'packages/shell/policy.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', external: ['@deepseek-ai/*'],
});
await compile({
  absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: ['src/host/role-tool.ts'], outfile: 'packages/shell/roles.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', external: ['@deepseek-ai/*'],
});
// zod is bundled because DSH does not expose it to plugins; minify keeps the published package small.
// task_run (src/host/task-tool.ts) is withdrawn from the Master and is not built or shipped.
await compile({ absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: ['src/host/batch-tool.ts'], outfile: 'packages/shell/batch.js', bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node22', external: ['@deepseek-ai/*'] });
await compile({ absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: ['src/host/edit-batch-tool.ts'], outfile: 'packages/shell/edit-batch.js', bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node22', external: ['@deepseek-ai/*'] });
await compile({ absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: ['src/host/judge-tool.ts'], outfile: 'packages/shell/judge.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', external: ['@deepseek-ai/*'] });
await compile({ absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: ['src/host/pixie-loop-tool.ts'], outfile: 'packages/shell/loop.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', external: ['@deepseek-ai/*'] });
// The Exa /contents fetch provider is a separate profile plugin package (#39); its schemastery dependency stays external.
await compile({ absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: ['src/host/web-fetch-exa.ts'], outfile: 'packages/web-fetch-exa/index.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', external: ['@deepseek-ai/*'] });
for (const part of ['shell']) {
  await compile({
    absWorkingDir: root, tsconfig: 'tsconfig.host.json', entryPoints: [`src/host/${part}.ts`], outfile: `packages/${part}/index.js`,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', external: ['@deepseek-ai/*'],
  });
  await compile({
    absWorkingDir: root, tsconfig: 'tsconfig.client.json', entryPoints: [`src/${part}.tsx`], outfile: `packages/${part}/client.js`,
    bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit'],
    banner: { js: `window.__ModuleLoader__.load({id: '${packageName}', factory: (require) => { const module = { exports: {} }; const exports = module.exports;` },
    footer: { js: 'return module.exports; }});' },
  });
}

// Agent skills ship as files next to index.js; the Host installs them into <DSH home>/skills on start.
// The folder is rebuilt from scratch so skills from earlier builds or other branches never reach the package.
import { cp, mkdir as mkdirp, rm } from 'node:fs/promises';
await rm(new URL('packages/shell/skills/', import.meta.url), { recursive: true, force: true });
const skillOut = new URL('packages/shell/skills/studio-pixie-hook-guide/', import.meta.url);
await mkdirp(skillOut, { recursive: true });
// Docs live in release/docs here and in docs/ in the published repository.
import { existsSync } from 'node:fs';
const docsRoot = ['release/docs/', 'docs/'].map(dir => new URL(dir, import.meta.url)).find(url => existsSync(new URL('appendix/pixie-gate.md', url)));
if (!docsRoot) throw new Error('build: Pixie Gate guide not found in release/docs or docs');
await cp(new URL('appendix/studio-pixie-hook-guide/SKILL.md', docsRoot), new URL('SKILL.md', skillOut));
await cp(new URL('appendix/pixie-gate.md', docsRoot), new URL('guide.md', skillOut));
const loopSkillOut = new URL('packages/shell/skills/studio-pixie-loop-guide/', import.meta.url);
await mkdirp(loopSkillOut, { recursive: true });
await cp(new URL('appendix/studio-pixie-loop-guide/SKILL.md', docsRoot), new URL('SKILL.md', loopSkillOut));
await cp(new URL('appendix/pixie-loop.md', docsRoot), new URL('guide.md', loopSkillOut));
// studio-provider-guide is not shipped: SettingsX providers are excluded from the release (#28 D10).
