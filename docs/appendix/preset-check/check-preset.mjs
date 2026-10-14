#!/usr/bin/env node
/**
 * DSH Studio preset check: compare what a Studio preset stores with what a session received.
 *
 *   node check-preset.mjs <session-id> [--profile desktop] [--home ~/.dsh] [--json]
 *
 * Read-only. The preset file (<home>/profiles/<profile>/studio-data/presets.json) is the source of
 * truth for what was configured. The session log (<home>/sessions/<project>/<session>/
 * session.v4.jsonl.zstd) shows what the model received. Each check reports pass, fail, or
 * unknown, and every unknown says why.
 *
 * The session log is DSH's internal storage, not a public API. Unrecognised formats report unknown
 * instead of guessing. Requires Node.js 22.15 or later (built-in zstd), or the `zstd` command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const SESSION_FORMAT = 4;
const STUDIO_PACKAGE = '@matamt-dbg/dsh-studio';
const ROLE_TOOL = 'subagent_role';
/** First sentence of each DSH usage-instruction section a Tool Filter removes with its tool. */
const GUIDANCE = {
  'tool:bash': 'Check the [exit code: N] marker',
  'tool:jobs': 'Track every background job id you start',
  'tool:workflow': 'tool ONLY when the user explicitly asks for a workflow',
  'tool:read': 'Use the read tool',
  'tool:write': 'Read an existing file before overwriting it',
  'tool:edit': 'Read a file before editing it',
  'tool:grep': 'Use the grep tool',
  'tool:glob': 'Use the glob tool',
};
/** Which tools own each section, mirroring Studio's tool-prompt-sections map. */
const SECTION_TOOLS = {
  'tool:bash': ['bash'], 'tool:jobs': ['job_list', 'job_output', 'job_kill'], 'tool:workflow': ['workflow'],
  'tool:read': ['read'], 'tool:write': ['write'], 'tool:edit': ['edit'], 'tool:grep': ['grep'], 'tool:glob': ['glob'],
};

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const valued = new Set(['--profile', '--home'].map(option));
const target = args.find(arg => !arg.startsWith('--') && !valued.has(arg));
if (!target) {
  console.error('usage: node check-preset.mjs <session-id> [--profile desktop] [--home ~/.dsh] [--json]');
  process.exit(2);
}
const home = option('--home') ?? process.env.DSH_HOME ?? path.join(homedir(), '.dsh');
const profile = option('--profile') ?? 'desktop';
const sessionId = target.startsWith('session-') ? target : `session-${target}`;

// ---------------------------------------------------------------- reading

function decompress(file) {
  const data = readFileSync(file);
  if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(data).toString('utf8');
  return execFileSync('zstd', ['-dc', file], { encoding: 'utf8', maxBuffer: 1 << 30 });
}

function sessionFiles() {
  const root = path.join(home, 'sessions');
  if (!existsSync(root)) throw new Error(`No sessions directory at ${root}`);
  return readdirSync(root).flatMap(project => {
    let entries; try { entries = readdirSync(path.join(root, project)); } catch { return []; }
    return entries.map(id => ({ id, file: path.join(root, project, id, `session.v${SESSION_FORMAT}.jsonl.zstd`) })).filter(entry => existsSync(entry.file));
  });
}

function events(file) {
  return decompress(file).split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

/** What the first model request of a session carried. */
function received(id, log) {
  const header = log.find(event => event.type === 'session') ?? {};
  const request = log.find(event => event.type === 'request/header')?.data?.header;
  const system = log.find(event => event.type === 'system/message')?.data?.message?.content?.map(block => block.text ?? '').join('\n');
  const descriptor = log.find(event => event.type === 'subagent/descriptor')?.data;
  const results = log.filter(event => event.type === 'tool/result').map(event => event.data?.message?.content?.map(block => block.text ?? '').join(' ') ?? '');
  return {
    id, format: header.version, createdAt: header.createdAt, parentSession: header.parentSession ?? null,
    preset: log.filter(event => event.type === 'agent-preset/selected').map(event => event.data.agentPreset).at(-1) ?? header.agentPreset ?? null,
    provider: descriptor?.provider ?? null, label: descriptor?.label ?? null, model: descriptor?.agentModel ?? request?.config?.model ?? null,
    persona: descriptor?.persona ?? null, toolFilter: descriptor?.toolFilter?.deny ?? null,
    tools: request?.tools ?? null, system: system ?? null,
    rejections: results.filter(text => /^Error: (Tool excluded by Studio|Studio preset policy could not be installed|Studio policy selected tools unavailable)/.test(text)),
  };
}

function studioState(presetId) {
  const dir = path.join(home, 'profiles', profile);
  const manifest = path.join(dir, 'node_modules', ...STUDIO_PACKAGE.split('/'), 'package.json');
  const installed = existsSync(manifest) ? { version: JSON.parse(readFileSync(manifest, 'utf8')).version, at: statSync(manifest).mtimeMs } : undefined;
  const store = path.join(dir, 'studio-data', 'presets.json');
  const preset = existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')).presets?.find(row => row.id === presetId) : undefined;
  return { installed, preset, store };
}

function appStart() {
  if (process.platform !== 'darwin' || profile !== 'desktop') return undefined;
  try {
    const row = execFileSync('ps', ['-axo', 'lstart=,command='], { encoding: 'utf8' }).split('\n').find(line => /\/MacOS\/DeepSeek Harness$/.test(line.trim()));
    const at = row ? Date.parse(row.trim().slice(0, 24)) : NaN;
    return Number.isNaN(at) ? undefined : at;
  } catch { return undefined; }
}

// ---------------------------------------------------------------- expectations

/** Tools the preset applies: generic subagent tools fold into subagent_role, as Studio does on apply. */
function presetTools(request, roles) {
  const generic = ['subagent', 'subagent_fork', 'list_subagent_models'];
  const delegates = roles.length > 0 || request.tools.some(name => name === ROLE_TOOL || generic.includes(name));
  const rest = request.tools.filter(name => name !== ROLE_TOOL && !generic.includes(name) && name !== 'task_run');
  return [...new Set(delegates ? [...rest, ROLE_TOOL] : rest)];
}

/** A role's filtered tools: default, default + list (extend), or list alone (replace; also mode-less lists). */
function roleFilter(role, presetDefault) {
  if (!role?.toolFilter) return [...presetDefault];
  const mode = role.toolFilter.mode ?? 'replace';
  return mode === 'extend' ? [...new Set([...presetDefault, ...role.toolFilter.deny])] : [...role.toolFilter.deny];
}
const roleMode = role => role?.toolFilter ? role.toolFilter.mode ?? 'replace' : 'default';

// ---------------------------------------------------------------- checks

const results = [];
const check = (scope, name, status, detail) => results.push({ scope, name, status, detail });
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const diff = (a, b) => ({ missing: b.filter(x => !a.includes(x)), extra: a.filter(x => !b.includes(x)) });
const describe = ({ missing, extra }) => [missing.length && `missing ${missing.join(', ')}`, extra.length && `extra ${extra.join(', ')}`].filter(Boolean).join('; ');

const files = sessionFiles();
const parentEntry = files.find(entry => entry.id === sessionId);
if (!parentEntry) throw new Error(`Session ${sessionId} not found under ${home}/sessions`);
const parent = received(sessionId, events(parentEntry.file));
const { installed, preset, store } = studioState(parent.preset);
const started = appStart();

// Build: a session runs the Studio build its app loaded at start.
if (parent.format !== SESSION_FORMAT) check('build', 'session format', 'unknown', `session log format ${parent.format}, this script reads ${SESSION_FORMAT}`);
if (!installed) check('build', 'Studio installed', 'fail', `${STUDIO_PACKAGE} not found in profile ${profile}`);
else if (parent.createdAt && installed.at > parent.createdAt) check('build', 'session ran the installed build', 'fail', `Studio ${installed.version} was installed after the session started; the session ran an earlier build`);
else if (started && installed.at > started) check('build', 'session ran the installed build', 'fail', `Studio ${installed.version} was installed after the running app started; restart the app`);
else if (started && parent.createdAt && started > parent.createdAt) check('build', 'session ran the installed build', 'unknown', 'the running app started after this session, so the build that ran it is not known; start a new session');
else check('build', 'session ran the installed build', 'pass', `Studio ${installed.version}`);

if (!preset) {
  check('preset', 'stored preset', 'fail', `${parent.preset ?? '(no preset)'} is not a Studio preset in ${store}`);
} else {
  const request = preset.request;
  const roles = Array.isArray(preset.agents) ? preset.agents : [];
  if (!preset.applied) check('preset', 'applied', 'fail', 'the preset is saved but not applied to DSH');
  else if (preset.status === 'modified') check('preset', 'applied', 'unknown', 'saved after its last apply; the session used the applied snapshot, which may differ from the stored request below');
  else check('preset', 'applied', 'pass', `applied ${preset.appliedAt}`);
  if (preset.appliedAt && parent.createdAt && Date.parse(preset.appliedAt) > parent.createdAt) check('preset', 'applied before session', 'unknown', 'the preset was re-applied after this session started; expectations follow the current preset');

  // Parent: tools, descriptions, defaults, prompt.
  const expectedTools = presetTools(request, roles);
  if (!parent.tools) check('parent', 'tools', 'unknown', 'no model request recorded yet');
  else {
    const names = parent.tools.map(tool => tool.name);
    const delta = diff(names, expectedTools);
    check('parent', 'tools', same(names, expectedTools) ? 'pass' : 'fail', same(names, expectedTools) ? `${names.length} tools` : describe(delta));
    const byName = new Map(parent.tools.map(tool => [tool.name, tool]));
    for (const [name, override] of Object.entries(request.toolOverrides ?? {})) {
      const tool = byName.get(name);
      if (!tool) { check('parent', `${name} description`, 'unknown', 'tool not in the request'); continue; }
      if (override.description !== undefined) check('parent', `${name} description`, tool.description === override.description ? 'pass' : 'fail', tool.description === override.description ? 'matches' : 'differs from the stored override');
      for (const [field, text] of Object.entries(override.parameters ?? {})) {
        let node = tool.parameters;
        for (const segment of field.split('.')) node = node?.properties?.[segment];
        check('parent', `${name}.${field} description`, node?.description === text ? 'pass' : 'fail', node ? (node.description === text ? 'matches' : 'differs from the stored override') : 'parameter not found');
      }
    }
    for (const [name, defaults] of Object.entries(request.execution?.defaults ?? {})) for (const [field, value] of Object.entries(defaults)) {
      const node = byName.get(name)?.parameters?.properties?.[field];
      check('parent', `${name}.${field} default`, node?.default === value ? 'pass' : 'fail', node ? `request default ${node.default ?? 'none'}, stored ${value}` : 'parameter not found');
    }
  }
  if (!parent.system) check('parent', 'additional instructions', 'unknown', 'no system prompt recorded yet');
  else {
    if (request.prompt) check('parent', 'additional instructions', parent.system.includes(request.prompt.trim()) ? 'pass' : 'fail', 'Studio additional instructions in the system prompt');
    const persona = request.providerConfigs?.['@deepseek-ai/dsh-persona'];
    for (const key of ['prefix', 'suffix']) if (typeof persona?.[key] === 'string' && persona[key]) {
      // {{model}} is interpolated at assembly; compare the text around it.
      const parts = persona[key].split('{{model}}').map(part => part.trim()).filter(Boolean);
      check('parent', `persona ${key}`, parts.every(part => parent.system.includes(part)) ? 'pass' : 'fail', 'edited persona text in the system prompt');
    }
    for (const [section, text] of Object.entries(request.sections ?? {})) {
      if (text) check('parent', `${section} instructions`, parent.system.includes(text.trim()) ? 'pass' : 'fail', 'edited usage instructions in the system prompt');
    }
  }
  if (parent.rejections.length) check('parent', 'policy', 'fail', `${parent.rejections.length} call(s) rejected by the Studio policy: ${parent.rejections[0].slice(0, 120)}`);

  // Subagents: each child against its role.
  const presetDefault = request.subagentToolFilter?.deny ?? [];
  const children = files.filter(entry => entry.id !== sessionId).flatMap(entry => {
    let first; try { first = JSON.parse(decompress(entry.file).split('\n', 1)[0]); } catch { return []; }
    return first.parentSession === sessionId ? [received(entry.id, events(entry.file))] : [];
  });
  if (!children.length) check('subagents', 'children', 'unknown', 'this session started no subagents');
  for (const child of children) {
    const scope = `subagent ${child.id.slice(0, 13)} (${child.label ?? '?'}, ${child.provider ?? '?'})`;
    // The role is not recorded; match by label (the role name) first, then by spawn mode if unique.
    const byLabel = roles.filter(role => role.name === child.label);
    const spawn = child.provider === 'fork' ? 'fork' : 'fresh';
    const bySpawn = roles.filter(role => role.spawn === spawn);
    const role = byLabel.length === 1 ? byLabel[0] : !roles.length ? undefined : bySpawn.length === 1 ? bySpawn[0] : null;
    if (role === null) { check(scope, 'role', 'unknown', `cannot tell which role started it (label ${child.label})`); continue; }
    check(scope, 'role', 'pass', role ? `${role.role}, Tool Filter mode ${roleMode(role)}` : 'no roles: implicit subagent with the preset default');
    if (role) {
      check(scope, 'spawn mode', role.spawn === spawn ? 'pass' : 'fail', `role ${role.spawn}, started ${child.provider}`);
      if (role.model !== 'inherit') check(scope, 'model', role.model.endsWith(`/${child.model}`) ? 'pass' : 'fail', `role ${role.model}, child ${child.model}`);
    }
    const expectedFilter = roleFilter(role, presetDefault).filter(name => expectedTools.includes(name));
    const recorded = child.toolFilter ?? [];
    check(scope, 'Tool Filter', same(recorded, expectedFilter) ? 'pass' : 'fail', `expected ${JSON.stringify(expectedFilter.sort())}, recorded ${JSON.stringify([...recorded].sort())}`);
    if (!child.tools) { check(scope, 'tools', 'unknown', 'no model request recorded yet'); continue; }
    const names = child.tools.map(tool => tool.name);
    const expected = expectedTools.filter(name => !expectedFilter.includes(name));
    check(scope, 'tools', same(names, expected) ? 'pass' : 'fail', same(names, expected) ? `${names.length} tools = parent − Tool Filter` : describe(diff(names, expected)));
    if (child.system) for (const [section, owners] of Object.entries(SECTION_TOOLS)) {
      const hidden = owners.every(name => expectedFilter.includes(name) || !expectedTools.includes(name)) && owners.some(name => expectedFilter.includes(name));
      if (!hidden) continue;
      check(scope, `${section} instructions removed`, child.system.includes(GUIDANCE[section]) ? 'fail' : 'pass', hidden ? 'its tools are filtered for this subagent' : '');
    }
    if (child.rejections.length) check(scope, 'policy', 'fail', `${child.rejections.length} call(s) rejected: ${child.rejections[0].slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------- output

const summary = { pass: 0, fail: 0, unknown: 0 };
for (const result of results) summary[result.status]++;
if (args.includes('--json')) {
  console.log(JSON.stringify({ session: sessionId, profile, preset: parent.preset, studio: installed?.version ?? null, summary, results }, null, 2));
} else {
  console.log(`Session ${sessionId}  preset ${parent.preset ?? '(none)'}  profile ${profile}  Studio ${installed?.version ?? 'not installed'}`);
  let scope;
  for (const result of results) {
    if (result.scope !== scope) { scope = result.scope; console.log(`\n${scope}`); }
    console.log(`  ${result.status.toUpperCase().padEnd(7)} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
  }
  console.log(`\n${summary.pass} pass, ${summary.fail} fail, ${summary.unknown} unknown`);
}
process.exitCode = summary.fail ? 1 : 0;
