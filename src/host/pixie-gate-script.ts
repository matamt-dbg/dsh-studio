import { access, readdir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { HOOK_EXIT, type GateTask } from '../pixie-gate-task.ts';

export interface HookContext {
  sessionId: string; cwd?: string | undefined; turn: number; agent: 'root' | 'child';
  tool?: { name: string; arguments: unknown };
  sandboxPolicy?: { mode: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot: string; sessionId?: string } | undefined;
}
export interface HookShellRequest {
  command: string; workdir: string; timeoutMs: number; onExpiry: 'kill'; stdoutMaxBytes: number;
  signal: AbortSignal; stdin: string; env: Record<string, string>;
  sandboxPolicy: NonNullable<HookContext['sandboxPolicy']>;
}
export interface HookShell {
  resolve(request: HookShellRequest): HookShellRequest;
  execute(spec: HookShellRequest): Promise<{ result(): Promise<{
    exitCode: number | null; timedOut: boolean; aborted?: boolean;
    stdout: { text: string; truncated: boolean }; stderr: { text: string };
  }> }>;
}
export function validScriptName(name: string) { return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) && !name.includes('..'); }
export async function scriptPath(directory: string, name: string): Promise<string> {
  if (!validScriptName(name)) throw new Error('Invalid gate script filename');
  const root = await realpath(directory), path = await realpath(resolve(directory, name));
  if (dirname(path) !== root || !(await stat(path)).isFile()) throw new Error('Hook script escapes commands directory or is not a file');
  await access(path, constants.X_OK);
  return path;
}
export async function listGateScripts(directory: string, supported: boolean) {
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { directory, supported, scripts: [] as string[] }; throw error; }
  const scripts: string[] = [];
  for (const name of names) { try { await scriptPath(directory, name); scripts.push(name); } catch { /* Not an executable, contained script. */ } }
  return { directory, supported, scripts: scripts.sort() };
}
export async function runHookScript(task: GateTask, target: string, signal: AbortSignal, deps: { scriptDirectory?: string; shell?: HookShell | undefined; scriptSupported?: boolean }, context?: HookContext, helperEnv: () => Promise<Record<string, string>> = async () => ({})) {
  if (!deps.scriptSupported || !deps.shell) throw new Error('hook-script-unsupported: 이 환경에서는 훅 스크립트를 지원하지 않음');
  if (!context?.cwd || !context.sandboxPolicy || context.sandboxPolicy.sessionId !== context.sessionId || !context.sandboxPolicy.workspaceRoot || !['read-only', 'workspace-write', 'danger-full-access'].includes(context.sandboxPolicy.mode)) throw new Error('Session sandbox policy and cwd are required');
  if (!deps.scriptDirectory) throw new Error('Hook script directory is required');
  const path = await scriptPath(deps.scriptDirectory, task.advanced.script!);
  signal.throwIfAborted();
  const env: Record<string, string> = { PIXIE_POINT: task.when, PIXIE_AGENT: context.agent, PIXIE_SESSION_ID: context.sessionId, PIXIE_TURN: String(context.turn), PIXIE_GATE_NAME: task.name };
  if (context.tool) { env.PIXIE_TOOL_NAME = context.tool.name; env.PIXIE_TOOL_ARGS = JSON.stringify(context.tool.arguments) ?? ''; }
  Object.assign(env, await helperEnv());
  signal.throwIfAborted();
  const spec = deps.shell.resolve({ command: `'${path.replace(/'/g, `'"'"'`)}'`, workdir: context.cwd, sandboxPolicy: context.sandboxPolicy,
    timeoutMs: task.advanced.timeoutMs, onExpiry: 'kill', stdoutMaxBytes: 256 * 1024, signal, stdin: target, env });
  const output = await (await deps.shell.execute(spec)).result();
  signal.throwIfAborted();
  if (output.timedOut) throw new Error('Hook script timed out');
  if (output.aborted) throw new Error('Hook script aborted');
  if (output.stdout.truncated || Buffer.byteLength(output.stdout.text) > 256 * 1024) throw new Error('Hook stdout exceeds 256KB');
  if (output.exitCode === HOOK_EXIT.skip) return { skipped: true, instruction: task.instruction };
  if (output.exitCode !== HOOK_EXIT.continue) throw new Error(`Hook script exit ${output.exitCode}: ${output.stderr.text}`);
  const text = output.stdout.text.replace(/^[\r\n]+|[\r\n]+$/g, '');
  let data = '';
  try { const value: unknown = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) data = JSON.stringify(value); } catch { /* Text output is allowed. */ }
  const name = task.advanced.script!.replace(/\.[^.]+$/, '');
  const instruction = task.instruction.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key: string) => {
    if (key === `hooks.${name}.text`) return text;
    if (key === `hooks.${name}.data`) return data;
    throw new Error(`Unknown prompt variable: ${key}`);
  });
  return { skipped: false, instruction };
}
