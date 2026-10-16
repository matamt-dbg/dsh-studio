import { listGateScripts, type HookShell, type HookContext } from './pixie-gate-script.ts';
import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { join, resolve } from 'node:path';
import type { JevKeyStatus, PixieAskFrame, PixieContextMode, PixieSessionRecord, PixieSettings, PixieTurn, PixieUsageTotal } from '../pixie-contracts.ts';
import { totalUsage } from '../pixie-contracts.ts';
import { pixieCommand } from './pixie-command.ts';
import { PixieLive } from './pixie-live.ts';
import { PixieGateStore, type PixieGateRecorder } from './pixie-gate-store.ts';
import type { GateRejection, GateRunFrame, SessionGates } from '../pixie-gate-contracts.ts';
import { enabledFor } from '../pixie-gate-task.ts';
import { PixieRuntime, type PixieLlm } from './pixie-runtime.ts';
import { parsePixieModel, PixieSettingsStore, PixieStore } from './pixie-store.ts';
import type { ForkEvent } from './pixie-fork.ts';
import { PixieGateDefinitions } from './pixie-gate-definitions.ts';
import { gateInput, type GateInputDeps } from './pixie-gate-input.ts';
import { gateTurn } from './pixie-gate-turn.ts';
import { gateTools } from './pixie-gate-tools.ts';
import { GateTaskRunner } from './pixie-gate-task-runner.ts';
import { HELPER_ROUTE, PixieGateHelper } from './pixie-gate-helper.ts';
import { PixieGateSettings } from './pixie-gate-settings.ts';
import { trialGate } from './pixie-gate-trial.ts';
import { JEV_KEY_REF, judgeEngineFor, type JevCredentials } from './jev-judge.ts';

/** What the Pixie tab shows for one session. */
export interface PixieView {
  record: PixieSessionRecord;
  total: PixieUsageTotal;
  running: boolean;
  /** Frames of the request now streaming, for a view that opened mid-answer. */
  frames: PixieAskFrame[];
  settings: PixieSettings;
  /** Context window of the active thread's model, when the adapter declares it. */
  contextWindow?: number;
}

interface SessionControllerSlice {
  inspect(sessionId: string, signal?: AbortSignal): Promise<{ events: readonly ForkEvent[] }>;
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: readonly { sessionId: string }[] }>;
  modelCatalog(): Promise<unknown>;
}

/** How often records of deleted sessions are pruned while the Host runs. */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
interface WebServerSlice {
  readonly host: string; readonly port: number | undefined; readonly protocol?: 'http:' | 'https:';
  register(route: { kind: 'prefix'; path: string; handler: PixieGateHelper['handle'] }): () => void;
}
/** The slice of DSH `credentials` behind the Jev key; values are written and resolved, never returned to the Client. */
interface CredentialsSlice extends JevCredentials {
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>;
  set(ref: string, value: string): Promise<void>;
  unset(ref: string): Promise<void>;
}
interface LlmSlice extends PixieLlm { resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ context?: { contextWindow: number } }> }

const json = <T>(payload: string): T => JSON.parse(payload) as T;

/** Write through DSH credentials, coding the one known file-shape failure so the Client can show how to fix it.
 * DSH reads a bare `refs:` line (null) as an empty store but cannot add a key under it; the original text is kept.
 */
async function credentialWrite(write: () => Promise<void>): Promise<void> {
  try { await write(); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Expected YAML collection at refs\b/.test(message)) throw new Error(`[pixie/credentials-refs] ${message}`);
    throw error;
  }
}
const llmOf = (ctx: Context) => ctx.get('llm') as unknown as LlmSlice;

/** Remote `pixie`: a side model whose requests never enter a session's model-visible log.
 * Also registers `/pixie`. History lives in `<profile>/studio-data/pixie/<sessionId>.json` and follows the session:
 * archived sessions keep it, and records of sessions that no longer exist are pruned on start.
 */
export class PixieService extends TypertRemoteService {
  static inject = ['llm', 'sessionController', 'commands'];
  private defaultScriptDirectory: string;
  private gateSettings: PixieGateSettings;
  /** The configured folder, or `<data>/pixie-gate/commands` when none is set. Read per run so a change applies at once. */
  private async scriptDirectory() { return (await this.gateSettings.read()).scriptDirectory ?? this.defaultScriptDirectory; }
  /** Optional: the DSH credentials service, read per call so a later mount applies. */
  private credentials = () => this.ctx.get('credentials') as unknown as CredentialsSlice | undefined;
  private scriptSupported = () => process.platform !== 'win32' && !!this.ctx.get('shell');
  private store: PixieStore;
  private settings: PixieSettingsStore;
  private runtime: PixieRuntime;
  private live: PixieLive;
  private gates: PixieGateStore;
  private definitions: PixieGateDefinitions;
  private gateRunner: GateInputDeps['runner'];
  private helper: PixieGateHelper;
  private helperServer: WebServerSlice | undefined;
  /** Read at each issue: the port is known only after listen, and rc.2 has no `protocol` getter (plain HTTP). */
  get helperUrl(): string | undefined {
    const server = this.helperServer;
    if (!server || typeof server.port !== 'number' || !server.port) return undefined;
    // Scripts reach a wildcard bind through loopback; a concrete address is used as-is.
    const host = server.host === '0.0.0.0' ? '127.0.0.1' : server.host === '::' ? '::1' : server.host;
    return `${server.protocol ?? 'http:'}//${host.includes(':') ? `[${host}]` : host}:${server.port}${HELPER_ROUTE}`;
  }
  /** Internal producer API, intentionally not Remote. */
  get gateRecorder(): PixieGateRecorder { return this.gates; }
  constructor(ctx: Context, dataDir: string) {
    super(ctx, 'studioPixie');
    this.defaultScriptDirectory = resolve(dataDir, 'pixie-gate', 'commands');
    this.gateSettings = new PixieGateSettings(join(dataDir, 'pixie-gate', 'settings.json'));
    this.store = new PixieStore(join(dataDir, 'pixie'));
    this.gates = new PixieGateStore(join(dataDir, 'pixie'));
    this.settings = new PixieSettingsStore(join(dataDir, 'pixie-settings.json'));
    this.definitions = new PixieGateDefinitions(join(dataDir, 'pixie-gate', 'definitions.json'));
    this.helper = new PixieGateHelper({ binDirectory: resolve(dataDir, 'pixie-gate', 'bin'), url: () => this.helperUrl });
    // Helper route only while the DSH web server runs; without it scripts get no PIXIE_URL/PIXIE_TOKEN.
    ctx.inject(['webServer'] as never, scope => {
      const server = scope.get('webServer') as unknown as WebServerSlice;
      scope.effect(() => {
        const dispose = server.register({ kind: 'prefix', path: HELPER_ROUTE, handler: this.helper.handle });
        this.helperServer = server;
        return () => { this.helperServer = undefined; dispose(); };
      });
    });
    const gateDeps: GateInputDeps = {
      definitions: () => this.definitions.read(),
      disabledGates: sessionId => this.gates.disabledGates(sessionId),
      warn: message => ctx.logger.warn(message),
      preset: agent => ctx.get('agentPresets')?.composedPreset(agent.ctx),
      isRoot: agent => ctx.get('agents')?.roots().some(root => root.id === agent.id) ?? false,
      hookContext: (agent, turn, tool) => {
        const policy = ctx.get('sandboxPolicy') as unknown as { resolve(request: { session: typeof agent.session }): HookContext['sandboxPolicy'] } | undefined;
        return { sessionId: agent.id, cwd: agent.session.header.cwd, turn, agent: gateDeps.isRoot(agent) ? 'root' : 'child',
          sandboxPolicy: policy?.resolve({ session: agent.session }), ...(tool ? { tool } : {}) };
      },
      runner: async () => {
        const [settings, scriptDirectory] = await Promise.all([this.settings.read(), this.scriptDirectory()]);
        const llm: PixieLlm = { stream: options => llmOf(ctx).stream(options) };
        const judge = judgeEngineFor(settings, { llm, credentials: this.credentials() });
        return new GateTaskRunner({
        scriptDirectory, scriptSupported: this.scriptSupported(), shell: ctx.get('shell') as unknown as HookShell | undefined, helper: this.helper,
        llm, ...(settings.model ? { model: settings.model } : {}), ...(judge ? { judge } : {}),
        });
      },
      recorder: this.gates,
      emit: (event, run) => ctx.emit(event, run),
    };
    this.gateRunner = gateDeps.runner;
    ctx.on('agent/pre-step', gateInput(gateDeps), { prepend: true });
    ctx.on('agent/turn-stopping', gateTurn(gateDeps));
    const tools = gateTools(gateDeps);
    ctx.on('tools/pre-execute', tools.before, { prepend: true });
    ctx.on('tools/post-execute', tools.after, { prepend: true });
    const sessions = () => ctx.get('sessionController') as unknown as SessionControllerSlice;
    this.runtime = new PixieRuntime({
      store: this.store,
      llm: { stream: options => llmOf(ctx).stream(options) },
      settings: () => this.settings.read(),
      sessionEvents: async (sessionId, signal) => (await sessions().inspect(sessionId, signal)).events,
    });
    this.live = new PixieLive(this.runtime);
    // Cordis awaits an async disposer, so no turn is written after Studio stops.
    ctx.effect(() => async () => { await this.live.dispose(); });
    ctx.effect(() => (ctx.get('commands') as unknown as { register(definition: unknown): () => void }).register(pixieCommand(this.live)));
    // Follow session deletion: the durable list includes archived sessions, so only deleted ones lose their record.
    // A failed listing prunes nothing.
    ctx.effect(() => {
      const lifetime = new AbortController();
      let running: Promise<unknown> = Promise.resolve();
      const prune = () => {
        running = (async () => {
          const listed = await sessions().list({}, lifetime.signal);
          const existing = new Set(listed.items.map(item => item.sessionId));
          await this.store.prune(async sessionId => existing.has(sessionId));
          await this.gates.prune(async () => listed.items);
        })().catch(error => { if (!lifetime.signal.aborted) ctx.logger?.warn?.(`studio pixie: prune skipped: ${String(error)}`); });
      };
      const first = setTimeout(prune, 0);
      const timer = setInterval(prune, PRUNE_INTERVAL_MS);
      return async () => { clearTimeout(first); clearInterval(timer); lifetime.abort(); await running; };
    });
  }

  @Remote
  async view(sessionId: string): Promise<PixieView> {
    const [record, settings] = await Promise.all([this.store.read(sessionId), this.settings.read()]);
    const active = record.threads.find(thread => thread.id === record.activeThreadId);
    const model = active?.model ?? settings.model;
    let contextWindow: number | undefined;
    if (model) {
      try { contextWindow = (await llmOf(this.ctx).resolveModelInfo(model.provider, model.model)).context?.contextWindow; } catch { /* unknown routes show no limit */ }
    }
    const frames = this.live.current(sessionId);
    return { record, total: totalUsage(record), running: frames.length > 0, frames, settings, ...(contextWindow === undefined ? {} : { contextWindow }) };
  }

  /** Create a thread (정리 = start a new one); payload `{ mode?, model? }`. */
  @Remote
  async createThread(sessionId: string, payload: string) {
    const raw = json<{ mode?: PixieContextMode; model?: unknown }>(payload);
    if (raw.mode !== undefined && raw.mode !== 'fresh' && raw.mode !== 'fork') throw new Error('Pixie thread mode must be fresh or fork');
    return this.runtime.createThread(sessionId, { ...(raw.mode ? { mode: raw.mode } : {}), ...(raw.model ? { model: parsePixieModel(raw.model) } : {}) });
  }

  @Remote
  async activate(sessionId: string, threadId: string) { await this.store.activate(sessionId, threadId); return true; }

  @Remote
  async deleteThread(sessionId: string, threadId: string) { await this.live.deleteThread(sessionId, threadId); return true; }

  /** The turn a `/pixie` command started, for the conversation row; undefined while it is not recorded yet. */
  @Remote
  async commandTurn(sessionId: string, commandId: string): Promise<PixieTurn | null> {
    const record = await this.store.read(sessionId);
    for (const thread of record.threads) for (const turn of thread.turns) if (turn.commandId === commandId) return turn;
    return null;
  }

  /** Start a request; the answer arrives through `follow`. Payload `{ question, threadId? }`. */
  @Remote
  async ask(sessionId: string, payload: string) {
    const raw = json<{ question?: unknown; threadId?: unknown }>(payload);
    if (typeof raw.question !== 'string' || !raw.question.trim()) throw new Error('[pixie/empty] Pixie question is required');
    return this.live.start(sessionId, { question: raw.question.trim(), ...(typeof raw.threadId === 'string' ? { threadId: raw.threadId } : {}) });
  }

  /** 회수: cancel the running request of a session. */
  @Remote
  async cancel(sessionId: string) { return this.live.cancel(sessionId); }

  /** Stream frames of requests in one session until the caller disconnects. */
  @Remote({ mode: 'stream' })
  async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<PixieAskFrame> {
    // Snapshot and subscribe without yielding: replay precedes every new frame.
    // Sync also repairs a completion missed while the carrier was disconnected.
    const queue: PixieAskFrame[] = [{ type: 'sync' }, ...this.live.current(sessionId)];
    let wake: (() => void) | undefined;
    const stop = this.live.subscribe(sessionId, frame => { queue.push(frame); wake?.(); });
    const onAbort = () => wake?.();
    signal.addEventListener('abort', onAbort);
    try {
      while (!signal.aborted) {
        while (queue.length) yield queue.shift()!;
        if (signal.aborted) break;
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
      }
    } finally { stop(); signal.removeEventListener('abort', onAbort); }
  }

  /** Preview only: no gate records, lifecycle events or agent input are written. */
  @Remote
  async trialGate(payload: string, signal: AbortSignal) {
    return trialGate(json(payload), {
      runner: this.gateRunner,

    }, signal);
  }

  /** Scripts in the effective folder, plus whether that folder is the default. */
  @Remote
  async gateScripts() {
    const directory = await this.scriptDirectory();
    return { ...await listGateScripts(directory, this.scriptSupported()), defaultDirectory: this.defaultScriptDirectory, custom: directory !== this.defaultScriptDirectory };
  }

  /** Payload `{ scriptDirectory?: string }`; empty or absent restores the default folder. The folder is not created. */
  @Remote
  async saveGateScriptDirectory(payload: string) {
    await this.gateSettings.save(json(payload));
    return this.gateScripts();
  }

  @Remote
  async gateDefinitions() { return this.definitions.read(); }

  @Remote
  async saveGateDefinitions(payload: string) { return this.definitions.save(json(payload)); }

  @Remote
  async gateRuns(sessionId: string) { return this.gates.read(sessionId); }

  /** Marks an already resent/dismissed card; this method does not send input. */
  @Remote
  async resolveGateRejection(sessionId: string, runId: string, status: Exclude<GateRejection['status'], 'pending'>) {
    return this.gates.resolveRejection(sessionId, runId, status);
  }

  /** Gates that apply to this session's preset (switched on everywhere, attached, on for the preset), with the session switch. */
  @Remote
  async sessionGates(sessionId: string): Promise<SessionGates> {
    const agent = this.ctx.get('agents')?.get(sessionId as never) as unknown as { ctx: Context } | undefined;
    const preset = agent ? this.ctx.get('agentPresets')?.composedPreset(agent.ctx) : undefined;
    if (!preset) return { gates: [] };
    const [read, disabled] = await Promise.all([this.definitions.read(), this.gates.disabledGates(sessionId)]);
    const off = new Set(disabled);
    return { preset, gates: read.entries.filter(task => enabledFor(task, preset)).map(task => ({ id: task.id, name: task.name, when: task.when,
      ...(task.advanced.script ? { script: task.advanced.script } : {}), sessionEnabled: !off.has(task.id) })) };
  }

  @Remote
  async setSessionGate(sessionId: string, gateId: string, enabled: boolean): Promise<string[]> {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
    return this.gates.setGateEnabled(sessionId, gateId, enabled);
  }

  @Remote({ mode: 'stream' })
  async *followGates(sessionId: string, signal: AbortSignal): AsyncIterable<GateRunFrame> {
    yield* this.gates.follow(sessionId, signal);
  }

  @Remote
  async readSettings() { return this.settings.read(); }

  @Remote
  async saveSettings(payload: string) { return this.settings.save(json(payload)); }

  /** Jev API key state. Never includes the value. */
  @Remote
  async jevKeyStatus(): Promise<JevKeyStatus> {
    const credentials = this.credentials();
    if (!credentials) return { available: false, configured: false, writable: false };
    const info = await credentials.describe(JEV_KEY_REF);
    return { available: true, configured: info.configured, writable: info.writable, ...(info.source ? { source: info.source } : {}) };
  }

  /** Store the Jev API key in DSH credentials; payload `{ value }`. Returns the new state, not the value. */
  @Remote
  async saveJevKey(payload: string): Promise<JevKeyStatus> {
    const value = json<{ value?: unknown }>(payload).value;
    if (typeof value !== 'string' || !value.trim()) throw new Error('Jev API key is required');
    const credentials = this.credentials();
    if (!credentials) throw new Error('DSH credentials service is unavailable');
    await credentialWrite(() => credentials.set(JEV_KEY_REF, value.trim()));
    return this.jevKeyStatus();
  }

  @Remote
  async deleteJevKey(): Promise<JevKeyStatus> {
    const credentials = this.credentials();
    if (!credentials) throw new Error('DSH credentials service is unavailable');
    await credentialWrite(() => credentials.unset(JEV_KEY_REF));
    return this.jevKeyStatus();
  }

  @Remote
  async models() {
    return (this.ctx.get('sessionController') as unknown as SessionControllerSlice).modelCatalog();
  }
}
