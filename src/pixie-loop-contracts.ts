/** Pixie Loop (#31): the loop spec, compiled checks, pass rules, code checks, item results, and run records.
 * Shared by the Host engine, the `pixie_loop` tool, and the Client run view; no Host or Client runtime dependencies.
 */
import type { JudgeAnswer, JudgeQuestion, PixieUsage } from './pixie-contracts.ts';
import { validateJudgeRequest } from './pixie-contracts.ts';

/** Hard ceilings a spec cannot exceed, whatever it asks for. */
export const LOOP_LIMITS = {
  items: 2000, attempts: 10, steps: 100, concurrency: 8, inputChars: 32_000, sharedChars: 64_000, calibration: 10,
  codeChecks: 10, questions: 10, tokens: 50_000_000, timeMs: 6 * 60 * 60 * 1000,
  actTimeoutMs: 10 * 60 * 1000, observationChars: 32_000, options: 255,
} as const;
export const ACT_DEFAULTS = { timeoutMs: 120_000, maxObservationChars: 8_000 } as const;
/** Placeholders an `act.command` may use; each is replaced by a single-quoted shell word. */
export const ACT_VARIABLES = ['input', 'output', 'id'] as const;
export const LOOP_DEFAULTS = { maxAttempts: 3, concurrency: 4 } as const;

export interface LoopItem { id: string; input: string }
export interface LoopExample { input: string; output: string; observation?: string }

/** Deterministic checks run before the decision engine (D11). */
export type CodeCheck =
  | { type: 'placeholders' }
  | { type: 'regex'; pattern: string; flags?: string; expect: 'match' | 'no-match' }
  | { type: 'json'; keys?: string[] };

/** One pass condition per question: noul by threshold, choice by accepted options, score by minimum. */
export type PassRule =
  | { min: number }
  | { accept: string[] };

export interface LoopChecks { questions: Record<string, JudgeQuestion>; pass: Record<string, PassRule> }

/** Run one fixed tool on each output and judge what it observed (2차 S9). Only `bash` is allowed. */
export interface LoopAct {
  tool: 'bash';
  /** Shell command; `{{input}}`, `{{output}}`, `{{id}}` become single-quoted words. */
  command: string;
  timeoutMs: number;
  /** Required acknowledgement: retries and episodes run the command again. */
  safeToRepeat: true;
  /** Items may act at the same time only when each works on its own state; otherwise acts run one at a time. */
  isolated: boolean;
  maxObservationChars: number;
}
/** Shorten an observation before judging (S10); stateless Pixie call. */
export interface LoopExtract { instruction: string; maxChars: number }
/** Let the decision engine pick one of the options a fixed source lists (S13). Pixie never writes the options. */
export interface LoopSelect {
  instructions: string;
  /** JSON with an `options` array: the item input, or the latest act observation (episodes). */
  optionsFrom: 'input' | 'observation';
  /** Below this confidence the item is escalated instead of acting on a guess. */
  minConfidence: number;
}
export interface LoopOption { name: string; description: string }

export interface LoopSpec {
  items: { inline: LoopItem[] } | { path: string };
  shared?: string;
  work: { instruction: string };
  /** Natural-language criteria Pixie compiles into {@link LoopChecks}. Exactly one of `criteria` and `checks`. */
  criteria?: string;
  /** Checks given directly; still calibrated (O3). */
  checks?: LoopChecks;
  codeChecks?: CodeCheck[];
  /** Required whenever criteria or checks are given. */
  calibration?: { pass: LoopExample[]; fail: LoopExample[] };
  /** `retry` (default): retry until the checks pass. `episode`: act step by step until the checks say the goal is reached. */
  mode: 'retry' | 'episode';
  act?: LoopAct;
  extract?: LoopExtract;
  select?: LoopSelect;
  /** Group results by the final answer of one choice question (S12). */
  route?: { question: string };
  /** Tries per item (`retry`) or steps per episode (`episode`). */
  maxAttempts: number;
  concurrency: number;
  limits: { tokens: number; timeMs: number };
  output?: string;
}

/** What the engine judges: the item input and one output. Instructions name these fields. */
export interface LoopState { input: string; output: string; observation?: string }

export interface CodeCheckFailure { check: CodeCheck['type']; message: string }
export interface QuestionFailure { id: string; instructions: string; answer: JudgeAnswer; rule: PassRule }

export interface LoopAttempt {
  output: string;
  /** What `act` observed (after `extract`), when the spec acts. */
  observation?: string;
  /** Selection mode: the engine's answer for the pick. */
  selection?: { choice: string; confidence: number; probabilities: Record<string, number> };
  codeFailures: CodeCheckFailure[];
  answers?: Record<string, JudgeAnswer>;
  passed: boolean;
  /** Pixie's guess at what to fix (D4: never changes the verdict). */
  feedback?: string;
  error?: string;
}

export type LoopItemStatus = 'passed' | 'escalated' | 'error' | 'cancelled' | 'skipped';
export interface LoopItemResult { id: string; status: LoopItemStatus; output?: string; attempts: LoopAttempt[]; error?: string; bucket?: string }

export type LoopUsage = { pixie: PixieUsage; judge: PixieUsage };
export type LoopRunStatus = 'compiling' | 'running' | 'done' | 'stopped' | 'error' | 'cancelled';
export interface LoopRun {
  id: string;
  sessionId: string;
  status: LoopRunStatus;
  startedAt: number;
  finishedAt?: number;
  /** Last time the writer saved this run; an active run that stops updating was interrupted. */
  updatedAt?: number;
  instruction: string;
  mode?: LoopSpec['mode'];
  /** The recipe this run came from (3차), when any. */
  recipe?: string;
  /** Where the run started: the agent tool, a gate, or a hook script. */
  source?: 'tool' | 'gate' | 'hook';
  checks?: LoopChecks;
  compiledBy?: 'pixie' | 'spec';
  /** Why the run stopped early or failed to start. */
  reason?: string;
  total: number;
  items: LoopItemResult[];
  usage: LoopUsage;
  outputPath?: string;
}
export interface LoopRunRecord { version: 1; runs: LoopRun[] }
export type LoopRunFrame = { type: 'sync' } | { type: 'run'; run: LoopRun };

/** What the calling agent gets back (D9). */
export interface LoopSummary {
  runId: string;
  status: LoopRunStatus;
  reason?: string;
  passed: number;
  escalated: { id: string; attempts: number; failed: string[]; feedback?: string }[];
  errors: { id: string; error: string }[];
  skipped: number;
  /** Item counts per route bucket, when the spec routes. */
  buckets?: Record<string, number>;
  outputPath?: string;
  usage: LoopUsage;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field in ${where}: ${key}`);
}
function integer(value: unknown, min: number, max: number, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${where} must be an integer from ${min} to ${max}`);
  return value;
}

function validateCodeCheck(raw: unknown, index: number): CodeCheck {
  const where = `codeChecks[${index}]`;
  if (!object(raw)) throw new Error(`${where} must be an object`);
  if (raw.type === 'placeholders') { onlyKeys(raw, ['type'], where); return { type: 'placeholders' }; }
  if (raw.type === 'regex') {
    onlyKeys(raw, ['type', 'pattern', 'flags', 'expect'], where);
    if (!text(raw.pattern)) throw new Error(`${where} needs a pattern`);
    if (raw.flags !== undefined && (typeof raw.flags !== 'string' || !/^[imsu]*$/.test(raw.flags))) throw new Error(`${where} flags may use only i, m, s, u`);
    if (raw.expect !== 'match' && raw.expect !== 'no-match') throw new Error(`${where} expect must be match or no-match`);
    try { new RegExp(raw.pattern, raw.flags as string | undefined); } catch (error) { throw new Error(`${where} has an invalid pattern: ${error instanceof Error ? error.message : String(error)}`); }
    return { type: 'regex', pattern: raw.pattern, ...(raw.flags ? { flags: raw.flags as string } : {}), expect: raw.expect };
  }
  if (raw.type === 'json') {
    onlyKeys(raw, ['type', 'keys'], where);
    if (raw.keys !== undefined && (!Array.isArray(raw.keys) || !raw.keys.every(text))) throw new Error(`${where} keys must be non-empty strings`);
    return { type: 'json', ...(raw.keys ? { keys: [...raw.keys] as string[] } : {}) };
  }
  throw new Error(`${where} type must be placeholders, regex, or json`);
}

/** Validate checks: judge-valid questions, one pass rule per question that fits its type. */
export function validateLoopChecks(raw: unknown): LoopChecks {
  if (!object(raw)) throw new Error('checks must be an object');
  onlyKeys(raw, ['questions', 'pass'], 'checks');
  const { questions } = validateJudgeRequest({ state: '', questions: raw.questions });
  const ids = Object.keys(questions);
  if (ids.length > LOOP_LIMITS.questions) throw new Error(`checks may have at most ${LOOP_LIMITS.questions} questions`);
  if (!object(raw.pass)) throw new Error('checks.pass must map each question id to a rule');
  const pass: Record<string, PassRule> = {};
  for (const id of Object.keys(raw.pass)) if (!ids.includes(id)) throw new Error(`checks.pass names an unknown question: ${id}`);
  for (const id of ids) {
    const rule = raw.pass[id], question = questions[id]!;
    if (!object(rule)) throw new Error(`checks.pass.${id} is required`);
    if (question.type === 'choice') {
      onlyKeys(rule, ['accept'], `checks.pass.${id}`);
      const names = Object.keys(question.criteria);
      if (!Array.isArray(rule.accept) || !rule.accept.length || !rule.accept.every(name => typeof name === 'string' && names.includes(name))) throw new Error(`checks.pass.${id}.accept must list options of the question`);
      if (rule.accept.length === names.length) throw new Error(`checks.pass.${id}.accept must leave at least one failing option`);
      pass[id] = { accept: [...new Set(rule.accept as string[])] };
    } else {
      onlyKeys(rule, ['min'], `checks.pass.${id}`);
      const top = question.type === 'score' ? question.criteria.length - 1 : 1;
      if (typeof rule.min !== 'number' || !Number.isFinite(rule.min) || rule.min <= 0 || rule.min > top) throw new Error(`checks.pass.${id}.min must be above 0 and at most ${top}`);
      pass[id] = { min: rule.min };
    }
  }
  return { questions, pass };
}

function validateItem(raw: unknown, index: number): LoopItem {
  if (!object(raw)) throw new Error(`items[${index}] must be an object`);
  onlyKeys(raw, ['id', 'input'], `items[${index}]`);
  if (!text(raw.id) || raw.id.length > 200) throw new Error(`items[${index}].id must be a non-empty string up to 200 characters`);
  if (typeof raw.input !== 'string' || !raw.input.length) throw new Error(`items[${index}].input must be a non-empty string`);
  if (raw.input.length > LOOP_LIMITS.inputChars) throw new Error(`items[${index}].input exceeds ${LOOP_LIMITS.inputChars} characters`);
  return { id: raw.id, input: raw.input };
}

/** Validate items from a spec or a file; ids are unique. */
export function validateLoopItems(raw: unknown): LoopItem[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('items must be a non-empty array');
  if (raw.length > LOOP_LIMITS.items) throw new Error(`items may have at most ${LOOP_LIMITS.items} entries`);
  const items = raw.map(validateItem), ids = new Set<string>();
  for (const item of items) { if (ids.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`); ids.add(item.id); }
  return items;
}

/** Parse a JSONL items file: one `{ id, input }` per non-blank line. */
export function parseLoopItemsFile(content: string): LoopItem[] {
  const rows = content.split('\n').map((line, index) => [line.trim(), index + 1] as const).filter(([line]) => line);
  return validateLoopItems(rows.map(([line, number]) => {
    try { return JSON.parse(line) as unknown; } catch { throw new Error(`items file line ${number} is not JSON`); }
  }));
}

function validateExamples(raw: unknown, where: string): LoopExample[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error(`${where} needs at least one example`);
  if (raw.length > LOOP_LIMITS.calibration) throw new Error(`${where} may have at most ${LOOP_LIMITS.calibration} examples`);
  return raw.map((example, index) => {
    if (!object(example)) throw new Error(`${where}[${index}] must be an object`);
    onlyKeys(example, ['input', 'output', 'observation'], `${where}[${index}]`);
    if (typeof example.input !== 'string' || typeof example.output !== 'string') throw new Error(`${where}[${index}] needs input and output strings`);
    if (example.observation !== undefined && typeof example.observation !== 'string') throw new Error(`${where}[${index}].observation must be a string`);
    return { input: example.input, output: example.output, ...(example.observation !== undefined ? { observation: example.observation } : {}) };
  });
}

const relativePath = (value: unknown, where: string): string => {
  if (!text(value)) throw new Error(`${where} must be a non-empty path`);
  return value;
};

function validateAct(raw: unknown): LoopAct {
  if (!object(raw)) throw new Error('act must be an object');
  onlyKeys(raw, ['tool', 'command', 'timeoutMs', 'safeToRepeat', 'isolated', 'maxObservationChars'], 'act');
  if (raw.tool !== 'bash') throw new Error('act.tool must be bash');
  if (!text(raw.command)) throw new Error('act.command is required');
  for (const match of raw.command.matchAll(/{{\s*([^{}]*?)\s*}}/g)) if (!(ACT_VARIABLES as readonly string[]).includes(match[1]!)) throw new Error(`act.command uses an unknown variable: ${match[1]}`);
  if (quotedPlaceholder(raw.command)) throw new Error('act.command must use {{input}}, {{output}}, {{id}} as bare words, not inside quotes; Studio quotes them for you');
  if (raw.safeToRepeat !== true) throw new Error('act.safeToRepeat must be true: retries and episodes run the command again, so use act only for commands that are safe to repeat');
  if (raw.isolated !== undefined && typeof raw.isolated !== 'boolean') throw new Error('act.isolated must be a boolean');
  return {
    tool: 'bash', command: raw.command, safeToRepeat: true, isolated: raw.isolated === true,
    timeoutMs: raw.timeoutMs === undefined ? ACT_DEFAULTS.timeoutMs : integer(raw.timeoutMs, 1000, LOOP_LIMITS.actTimeoutMs, 'act.timeoutMs'),
    maxObservationChars: raw.maxObservationChars === undefined ? ACT_DEFAULTS.maxObservationChars : integer(raw.maxObservationChars, 100, LOOP_LIMITS.observationChars, 'act.maxObservationChars'),
  };
}
function validateExtract(raw: unknown): LoopExtract {
  if (!object(raw)) throw new Error('extract must be an object');
  onlyKeys(raw, ['instruction', 'maxChars'], 'extract');
  if (!text(raw.instruction)) throw new Error('extract.instruction is required');
  return { instruction: raw.instruction, maxChars: raw.maxChars === undefined ? 4000 : integer(raw.maxChars, 100, LOOP_LIMITS.observationChars, 'extract.maxChars') };
}
function validateSelect(raw: unknown): LoopSelect {
  if (!object(raw)) throw new Error('select must be an object');
  onlyKeys(raw, ['instructions', 'optionsFrom', 'minConfidence'], 'select');
  if (!text(raw.instructions)) throw new Error('select.instructions is required');
  if (raw.optionsFrom !== 'input' && raw.optionsFrom !== 'observation') throw new Error('select.optionsFrom must be input or observation');
  if (raw.minConfidence !== undefined && (typeof raw.minConfidence !== 'number' || raw.minConfidence < 0 || raw.minConfidence > 1)) throw new Error('select.minConfidence must be from 0 to 1');
  return { instructions: raw.instructions, optionsFrom: raw.optionsFrom, minConfidence: (raw.minConfidence as number | undefined) ?? 0 };
}

/** Read the options a source lists: JSON with `options` as names or `{ name, description }`. Pixie never fills them in. */
export function parseOptions(source: string, where: string): LoopOption[] {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error(`${where} is not JSON with an options array`); }
  const raw = object(parsed) ? parsed.options : undefined;
  if (!Array.isArray(raw) || raw.length < 2) throw new Error(`${where} needs an options array with at least 2 entries`);
  if (raw.length > LOOP_LIMITS.options) throw new Error(`${where} lists ${raw.length} options; the decision engine takes at most ${LOOP_LIMITS.options}. Narrow them first (group or filter in the act command).`);
  const options = raw.map((option, index) => {
    if (typeof option === 'string' && option.trim()) return { name: option, description: option };
    if (object(option) && text(option.name)) return { name: option.name, description: typeof option.description === 'string' && option.description.trim() ? option.description : option.name };
    throw new Error(`${where} options[${index}] must be a name or { name, description }`);
  });
  if (new Set(options.map(option => option.name)).size !== options.length) throw new Error(`${where} options must have unique names`);
  return options;
}

/** Whether a placeholder sits inside single or double quotes (or is glued to other text), where quoting it again would let shell syntax through. */
export function quotedPlaceholder(command: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote === "'") { if (char === "'") quote = undefined; else if (char === '{' && command[index + 1] === '{') return true; continue; }
    if (char === '\\') { index++; continue; }
    if (char === '"') { quote = quote === '"' ? undefined : '"'; continue; }
    if (char === "'" && !quote) { quote = "'"; continue; }
    if (char === '{' && command[index + 1] === '{') {
      const end = command.indexOf('}}', index);
      if (end < 0) continue;
      if (quote) return true;
      const before = command[index - 1], after = command[end + 2];
      if ((before !== undefined && !/\s/.test(before)) || (after !== undefined && !/[\s;|&)]/.test(after))) return true;
      index = end + 1;
    }
  }
  return false;
}

/** Quote a value as one POSIX shell word. */
export const shellWord = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
/** Fill `{{input}}`, `{{output}}`, `{{id}}` in an act command with quoted words. */
export function actCommand(command: string, values: Record<(typeof ACT_VARIABLES)[number], string>): string {
  return command.replace(/{{\s*(input|output|id)\s*}}/g, (_, name: (typeof ACT_VARIABLES)[number]) => shellWord(values[name]));
}

/** Validate a loop spec; anything unknown or out of range is an error before any model call. */
export function validateLoopSpec(raw: unknown): LoopSpec {
  if (!object(raw)) throw new Error('Loop spec must be an object');
  onlyKeys(raw, ['items', 'shared', 'work', 'criteria', 'checks', 'codeChecks', 'calibration', 'mode', 'act', 'extract', 'select', 'route', 'maxAttempts', 'concurrency', 'limits', 'output'], 'spec');
  if (!object(raw.items)) throw new Error('items must be { inline: [...] } or { path: "..." }');
  let items: LoopSpec['items'];
  if ('inline' in raw.items) { onlyKeys(raw.items, ['inline'], 'items'); items = { inline: validateLoopItems(raw.items.inline) }; }
  else if ('path' in raw.items) { onlyKeys(raw.items, ['path'], 'items'); items = { path: relativePath(raw.items.path, 'items.path') }; }
  else throw new Error('items must be { inline: [...] } or { path: "..." }');
  if (raw.shared !== undefined && (typeof raw.shared !== 'string' || raw.shared.length > LOOP_LIMITS.sharedChars)) throw new Error(`shared must be a string up to ${LOOP_LIMITS.sharedChars} characters`);
  if (!object(raw.work)) throw new Error('work must be { instruction }');
  onlyKeys(raw.work, ['instruction'], 'work');
  if (!text(raw.work.instruction)) throw new Error('work.instruction is required');
  if (raw.mode !== undefined && raw.mode !== 'retry' && raw.mode !== 'episode') throw new Error('mode must be retry or episode');
  const mode = (raw.mode ?? 'retry') as LoopSpec['mode'];
  const act = raw.act === undefined ? undefined : validateAct(raw.act);
  const extract = raw.extract === undefined ? undefined : validateExtract(raw.extract);
  const select = raw.select === undefined ? undefined : validateSelect(raw.select);
  if (raw.criteria !== undefined && raw.checks !== undefined) throw new Error('Give only one of criteria and checks');
  // Only a plain selection (choose once, no act) may skip review entirely: the choice is the result.
  if (raw.criteria === undefined && raw.checks === undefined && !(select && mode === 'retry' && !act)) throw new Error('Give exactly one of criteria and checks');
  if (raw.criteria !== undefined && !text(raw.criteria)) throw new Error('criteria must be a non-empty string');
  const checks = raw.checks === undefined ? undefined : validateLoopChecks(raw.checks);
  if (mode === 'episode' && !act) throw new Error('mode episode needs act: each step must change something and observe it');
  if (extract && !act) throw new Error('extract needs act: it shortens what act observed');
  if (select?.optionsFrom === 'observation' && mode !== 'episode') throw new Error('select.optionsFrom observation needs mode episode');
  let route: LoopSpec['route'];
  if (raw.route !== undefined) {
    if (!object(raw.route)) throw new Error('route must be { question }');
    onlyKeys(raw.route, ['question'], 'route');
    if (!text(raw.route.question)) throw new Error('route.question is required');
    if (checks && checks.questions[raw.route.question]?.type !== 'choice') throw new Error('route.question must name a choice question in checks');
    if (!checks && raw.criteria === undefined) throw new Error('route needs checks or criteria');
    route = { question: raw.route.question };
  }
  let codeChecks: CodeCheck[] | undefined;
  if (raw.codeChecks !== undefined) {
    if (!Array.isArray(raw.codeChecks) || raw.codeChecks.length > LOOP_LIMITS.codeChecks) throw new Error(`codeChecks must be an array of at most ${LOOP_LIMITS.codeChecks}`);
    codeChecks = raw.codeChecks.map(validateCodeCheck);
  }
  const reviewed = raw.criteria !== undefined || raw.checks !== undefined;
  let calibration: LoopSpec['calibration'];
  if (reviewed || raw.calibration !== undefined) {
    if (!object(raw.calibration)) throw new Error('calibration needs pass and fail examples');
    onlyKeys(raw.calibration, ['pass', 'fail'], 'calibration');
    calibration = { pass: validateExamples(raw.calibration.pass, 'calibration.pass'), fail: validateExamples(raw.calibration.fail, 'calibration.fail') };
  }
  if (!object(raw.limits)) throw new Error('limits needs tokens and timeMs');
  onlyKeys(raw.limits, ['tokens', 'timeMs'], 'limits');
  const limits = { tokens: integer(raw.limits.tokens, 1000, LOOP_LIMITS.tokens, 'limits.tokens'), timeMs: integer(raw.limits.timeMs, 1000, LOOP_LIMITS.timeMs, 'limits.timeMs') };
  return {
    items, work: { instruction: raw.work.instruction }, limits, mode,
    ...(calibration ? { calibration } : {}),
    ...(act ? { act } : {}), ...(extract ? { extract } : {}), ...(select ? { select } : {}), ...(route ? { route } : {}),
    ...(raw.shared ? { shared: raw.shared } : {}),
    ...(raw.criteria !== undefined ? { criteria: raw.criteria as string } : {}),
    ...(checks ? { checks } : {}),
    ...(codeChecks?.length ? { codeChecks } : {}),
    maxAttempts: raw.maxAttempts === undefined ? LOOP_DEFAULTS.maxAttempts : integer(raw.maxAttempts, 1, mode === 'episode' ? LOOP_LIMITS.steps : LOOP_LIMITS.attempts, 'maxAttempts'),
    concurrency: raw.concurrency === undefined ? LOOP_DEFAULTS.concurrency : integer(raw.concurrency, 1, LOOP_LIMITS.concurrency, 'concurrency'),
    ...(raw.output !== undefined ? { output: relativePath(raw.output, 'output') } : {}),
  };
}

/** Tokens that must survive a rewrite unchanged: inline code spans, Markdown link targets, `{name}`, `{{x}}`, `%s`/`%1$d`, `<tag>`/`</tag>`.
 * Code spans are matched first so placeholders inside them count once, as part of the span. */
const PLACEHOLDER = /`[^`\n]+`|\]\([^)\s]+\)|\{\{[^{}]+\}\}|\{[A-Za-z0-9_.-]+\}|%(?:\d+\$)?[sdif@]|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;
function tokens(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of value.matchAll(PLACEHOLDER)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  return counts;
}

/** Run deterministic checks; an empty list means every check passed. */
export function runCodeChecks(checks: readonly CodeCheck[], input: string, output: string): CodeCheckFailure[] {
  const failures: CodeCheckFailure[] = [];
  for (const check of checks) {
    if (check.type === 'placeholders') {
      const want = tokens(input), have = tokens(output);
      const missing = [...want].filter(([token, count]) => (have.get(token) ?? 0) < count).map(([token]) => token);
      const extra = [...have].filter(([token, count]) => (want.get(token) ?? 0) < count).map(([token]) => token);
      if (missing.length || extra.length) failures.push({ check: 'placeholders', message: [missing.length ? `missing ${missing.join(' ')}` : '', extra.length ? `unexpected ${extra.join(' ')}` : ''].filter(Boolean).join('; ') });
    } else if (check.type === 'regex') {
      const matched = new RegExp(check.pattern, check.flags).test(output);
      if (matched !== (check.expect === 'match')) failures.push({ check: 'regex', message: `output ${check.expect === 'match' ? 'does not match' : 'matches'} /${check.pattern}/${check.flags ?? ''}` });
    } else {
      let parsed: unknown;
      try { parsed = JSON.parse(output); } catch { failures.push({ check: 'json', message: 'output is not JSON' }); continue; }
      const missing = (check.keys ?? []).filter(key => !object(parsed) || !Object.hasOwn(parsed, key));
      if (missing.length) failures.push({ check: 'json', message: `missing keys ${missing.join(', ')}` });
    }
  }
  return failures;
}

/** Apply pass rules to answers; returns the questions that did not pass. */
export function failedQuestions(checks: LoopChecks, answers: Record<string, JudgeAnswer>): QuestionFailure[] {
  const failed: QuestionFailure[] = [];
  for (const [id, question] of Object.entries(checks.questions)) {
    const answer = answers[id], rule = checks.pass[id]!;
    if (!answer) throw new Error(`Missing answer for "${id}"`);
    const ok = 'accept' in rule ? answer.type === 'choice' && rule.accept.includes(answer.choice)
      : answer.type === 'noul' ? answer.noul >= rule.min : answer.type === 'score' && answer.score >= rule.min;
    if (!ok) failed.push({ id, instructions: question.instructions, answer, rule });
  }
  return failed;
}

export const emptyUsage = (): PixieUsage => ({ inputTokens: 0, outputTokens: 0 });
export function addUsage(total: PixieUsage, value: PixieUsage | undefined) {
  if (!value) return;
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (value[key] !== undefined) total[key] = (total[key] ?? 0) + value[key]!;
  }
}
export const usageTokens = (usage: LoopUsage) => usage.pixie.inputTokens + usage.pixie.outputTokens + usage.judge.inputTokens + usage.judge.outputTokens;

/** The agent-facing summary of a finished run (D9). */
export function summarizeRun(run: LoopRun): LoopSummary {
  const escalated = run.items.filter(item => item.status === 'escalated').map(item => {
    const last = item.attempts.at(-1);
    const failed = [...(last?.codeFailures.map(failure => `code:${failure.check}`) ?? []), ...(last?.answers && run.checks ? failedQuestions(run.checks, last.answers).map(failure => failure.id) : [])];
    return { id: item.id, attempts: item.attempts.length, failed, ...(last?.feedback ? { feedback: last.feedback } : {}) };
  });
  const buckets: Record<string, number> = {};
  for (const item of run.items) if (item.bucket) buckets[item.bucket] = (buckets[item.bucket] ?? 0) + 1;
  return {
    runId: run.id, status: run.status, ...(run.reason ? { reason: run.reason } : {}),
    ...(Object.keys(buckets).length ? { buckets } : {}),
    passed: run.items.filter(item => item.status === 'passed').length, escalated,
    errors: run.items.filter(item => item.status === 'error').map(item => ({ id: item.id, error: item.error ?? 'error' })),
    skipped: run.total - run.items.filter(item => item.status !== 'skipped' && item.status !== 'cancelled').length,
    ...(run.outputPath ? { outputPath: run.outputPath } : {}), usage: run.usage,
  };
}
