/** Pack the single publishable Studio package into dist (or STUDIO_PACK_DIST) and print the tarball path. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const source = path.join(root, 'packages/shell');
const dist = path.resolve(root, process.env.STUDIO_PACK_DIST ?? 'dist');
const staging = path.join(dist, 'package');
const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const file of manifest.files) await cp(path.join(source, file), path.join(staging, file), { recursive: true });
// Prefer the user-facing README in release/ when present.
const readme = ['release/README.md', 'README.md'].map(file => path.join(root, file)).find(file => existsSync(file));
// npm renders README without the repository tree: point relative docs/ links at the published repository.
const repository = manifest.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
const readmeText = await readFile(readme, 'utf8');
await writeFile(path.join(staging, 'README.md'), repository ? readmeText
  .replace(/src="(docs\/images\/[^"]+)"/g, (_, file) => `src="${repository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/${file}"`)
  .replace(/\]\((docs\/images\/[^)]+)\)/g, (_, file) => `](${repository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/${file})`)
  .replace(/\]\((docs\/[^)]+)\)/g, (_, file) => `](${repository}/blob/main/${file})`) : readmeText);
await cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'));
// Development-only links (workspace:*) never ship.
const { devDependencies: _dev, ...published } = manifest;
await writeFile(path.join(staging, 'package.json'), JSON.stringify(published, null, 2) + '\n');
const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dist], { cwd: staging, encoding: 'utf8' });
console.log(path.join(dist, JSON.parse(output)[0].filename));
