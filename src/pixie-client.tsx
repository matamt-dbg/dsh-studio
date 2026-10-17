/** Client half of Pixie: Remote descriptors, the Studio settings page, and the right-sidebar tab.
 * The tab registers only where the right sidebar exists, so Studio still loads without it.
 */
import React from 'react';
import type { GateRunFrame, GateRunRecord } from './pixie-gate-contracts.ts';
type GateTrialResponse = { output: import('./pixie-gate-task-contracts.ts').GateOutput; plan: ReturnType<typeof import('./pixie-gate-task-contracts.ts').gateOutputPlan>; usage: import('./pixie-contracts.ts').PixieUsage; skipped?: 'script' };
import type { GateTask } from './pixie-gate-task.ts';
import type { StudioContext } from './contracts.js';
import { PACKAGE_NAME } from './package-name.ts';
import { MarkdownProvider, StudioSurface, type MarkdownRenderer } from './ui.tsx';
import { PixieCommandRow, PixieTab, type PixieCommandRowActions, type PixieTabActions } from './pixie-tab.tsx';
import { GateResults, GateTail, type GateAnchor, type GateTailActions } from './pixie-gate-tail.tsx';
import { GATE_RESULT_NODE, gateResultDefinition, gateRunHub, type GateResultNode, type GateRunSource } from './pixie-gate-chat-node.ts';
import { PixieSettingsPage, type PixieSettingsActions } from './pixie-settings.tsx';
import { pixieText } from './pixie-locale.ts';
import type { PixieAskFrame, PixieSettings, PixieThread } from './pixie-contracts.ts';

const NAMESPACE = 'studioPixie';
const TAB_ID = `${PACKAGE_NAME}/pixie`;
const KIND = 'studio-pixie';

const stringCodec = { mode: 'strict', typeSymbol: 'string', create: () => ({ parse: (value: unknown) => { if (typeof value !== 'string') throw new TypeError('Expected a string'); return value; } }) } as const;
const parameter = (name: string) => ({ name, wire: name, source: 'json', codec: stringCodec });
const descriptor = (method: string, parameters: string[], extra: Record<string, unknown> = {}) => ({
  id: `${PACKAGE_NAME}#${NAMESPACE}/${method}`, service: NAMESPACE, namespace: NAMESPACE, method,
  invocation: { kind: 'direct' }, parameters: parameters.map(parameter), result: { mode: 'src-json' }, ...extra,
});

type RemoteValue<T> = Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>;
interface PixieRemote {
  gateRuns(sessionId: string): RemoteValue<GateRunRecord>;
  loopRuns(sessionId: string): RemoteValue<import('./pixie-loop-contracts.ts').LoopRunRecord>;
  loopRecipes(): RemoteValue<import('./pixie-loop-recipes.ts').LoopRecipeList>;
  saveLoopRecipe(payload: string, signal: AbortSignal): RemoteValue<import('./pixie-loop-recipes.ts').LoopRecipe>;
  deleteLoopRecipe(name: string): RemoteValue<import('./pixie-loop-recipes.ts').LoopRecipeList>;
  followGates(sessionId: string): AsyncIterable<GateRunFrame> & { dispose(): void };
  resolveGateRejection(sessionId: string, runId: string, status: string): RemoteValue<unknown>;
  sessionGates(sessionId: string): RemoteValue<import('./pixie-gate-contracts.ts').SessionGates>;
  setSessionGate(sessionId: string, gateId: string, enabled: boolean): RemoteValue<string[]>;
  view(sessionId: string): RemoteValue<import('./pixie-tab.tsx').PixieViewValue>;
  createThread(sessionId: string, payload: string): RemoteValue<PixieThread>;
  activate(sessionId: string, threadId: string): RemoteValue<boolean>;
  deleteThread(sessionId: string, threadId: string): RemoteValue<boolean>;
  commandTurn(sessionId: string, commandId: string): RemoteValue<import('./pixie-contracts.ts').PixieTurn | null>;
  ask(sessionId: string, payload: string): RemoteValue<{ threadId: string; turnId: string }>;
  cancel(sessionId: string): RemoteValue<boolean>;
  follow(sessionId: string): AsyncIterable<PixieAskFrame> & { dispose(): void };
  trialGate(payload: string, signal: AbortSignal): RemoteValue<GateTrialResponse>;
  gateScripts(): RemoteValue<import('./pixie-gate-task-pages.tsx').GateScriptList>;
  saveGateScriptDirectory(payload: string): RemoteValue<import('./pixie-gate-task-pages.tsx').GateScriptList>;
  gateDefinitions(): RemoteValue<import('./pixie-gate-definitions.ts').GateTasksRead>;
  saveGateDefinitions(payload: string): RemoteValue<unknown>;
  readSettings(): RemoteValue<PixieSettings>;
  saveSettings(payload: string): RemoteValue<PixieSettings>;
  models(): RemoteValue<unknown>;
  jevKeyStatus(): RemoteValue<import('./pixie-contracts.ts').JevKeyStatus>;
  saveJevKey(payload: string): RemoteValue<import('./pixie-contracts.ts').JevKeyStatus>;
  deleteJevKey(): RemoteValue<import('./pixie-contracts.ts').JevKeyStatus>;
}

async function unwrap<T>(call: RemoteValue<T>): Promise<T> {
  const result = await call;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

interface SidebarServices {
  sidebarRightTabs: { register(definition: { id: string; kind: string; priority?: string; title: () => string; guide?: readonly { id: string; order: number; title: () => string; description?: () => string }[] }): () => void };
  sidebarRight: { openTab(kind: string, options?: Record<string, unknown>): void };
}

/** Pixie Remote descriptors. The runtime accepts one contribution per package, so the shell mounts these with its own. */
export function pixieDescriptors() {
  return [
    descriptor('gateRuns', ['sessionId']),
    descriptor('loopRuns', ['sessionId']),
    descriptor('loopRecipes', []),
    descriptor('saveLoopRecipe', ['payload'], { cancellation: { parameter: 'signal' } }),
    descriptor('deleteLoopRecipe', ['name']),
    descriptor('followGates', ['sessionId'], { mode: 'stream', cancellation: { parameter: 'signal' } }),
    descriptor('resolveGateRejection', ['sessionId', 'runId', 'status']),
    descriptor('sessionGates', ['sessionId']),
    descriptor('setSessionGate', ['sessionId', 'gateId', 'enabled']),
    descriptor('view', ['sessionId']),
    descriptor('createThread', ['sessionId', 'payload']),
    descriptor('activate', ['sessionId', 'threadId']),
    descriptor('deleteThread', ['sessionId', 'threadId']),
    descriptor('commandTurn', ['sessionId', 'commandId']),
    descriptor('ask', ['sessionId', 'payload']),
    descriptor('cancel', ['sessionId']),
    descriptor('follow', ['sessionId'], { mode: 'stream', cancellation: { parameter: 'signal' } }),
    descriptor('trialGate', ['payload'], { cancellation: { parameter: 'signal' } }),
    descriptor('gateDefinitions', []),
    descriptor('gateScripts', []),
    descriptor('saveGateScriptDirectory', ['payload']),
    descriptor('saveGateDefinitions', ['payload']),
    descriptor('readSettings', []),
    descriptor('saveSettings', ['payload']),
    descriptor('models', []),
    descriptor('jevKeyStatus', []),
    descriptor('saveJevKey', ['payload']),
    descriptor('deleteJevKey', []),
  ];
}

/** Shared #25 stream lifecycle: the Host emits sync on each new connection. */
export function followPixieStream<T>(connect: () => AsyncIterable<T> & { dispose(): void }, listener: (frame: T) => void): () => void {
  let stopped = false;
  let handle: (AsyncIterable<T> & { dispose(): void }) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const run = async () => {
    while (!stopped) {
      try {
        handle = connect();
        for await (const frame of handle) { if (stopped) break; listener(frame); }
      } catch { /* carrier loss: reconnect and receive a fresh sync */ }
      finally { handle?.dispose(); handle = undefined; }
      if (!stopped) await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 1000); });
    }
  };
  void run();
  return () => { stopped = true; handle?.dispose(); clearTimeout(timer); wake?.(); };
}

/** Register Pixie's settings service (with the shared Studio menu footer), right-sidebar tab, and /pixie row. Call after the shell mounted {@link pixieDescriptors}. */
/** `markdown` renders Pixie output; the shell passes the DSH renderer so this module stays loadable in Node tests. */
export function mountPixie(ctx: StudioContext, options: { navFooter?: (locale: string) => React.ReactNode; markdown?: MarkdownRenderer } = {}): void {
  const withMarkdown = (node: React.ReactNode) => <MarkdownProvider value={options.markdown}>{node}</MarkdownProvider>;
  const remote = () => {
    const service = ctx.get(`remote.${NAMESPACE}` as never) as unknown as PixieRemote | undefined;
    if (!service) throw new Error('Pixie API unavailable');
    return service;
  };
  const locale = () => ctx.locale.getLocale().active;
  const useLocale = () => React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), locale);

  const settingsActions: PixieSettingsActions = {
    read: () => unwrap(remote().readSettings()),
    save: settings => unwrap(remote().saveSettings(JSON.stringify(settings))),
    models: () => unwrap(remote().models()) as ReturnType<PixieSettingsActions['models']>,
    jevKey: {
      status: () => unwrap(remote().jevKeyStatus()),
      save: value => unwrap(remote().saveJevKey(JSON.stringify({ value }))),
      remove: () => unwrap(remote().deleteJevKey()),
    },
  };
  const gateActions = {
    trial: (request: { task: GateTask; text: string; toolName?: string }) => {
      const controller = new AbortController();
      return { result: unwrap(remote().trialGate(JSON.stringify(request), controller.signal)), cancel: () => controller.abort() };
    },
    read: () => unwrap(remote().gateDefinitions()),
    save: (entries: GateTask[]) => unwrap(remote().saveGateDefinitions(JSON.stringify(entries))),
    scripts: () => unwrap(remote().gateScripts()),
    saveScriptDirectory: (scriptDirectory: string) => unwrap(remote().saveGateScriptDirectory(JSON.stringify({ scriptDirectory }))),
    // Studio-made presets only: Studio Master is a read-only view of the DSH composition, not a Studio preset.
    recipes: async () => (await unwrap(remote().loopRecipes())).recipes.map(recipe => recipe.name),
    presets: async () => {
      const catalog = ctx.get('remote.studioCatalog' as never) as unknown as { listPresets(): RemoteValue<{ id: string; name: string; readOnly?: boolean }[]> };
      return (await unwrap(catalog.listPresets())).filter(preset => !preset.readOnly).map(({ id, name }) => ({ id, name }));
    },
    // Public session Remote: verifies the Host path and opens it in Finder or Explorer.
    openFolder: async (path: string) => {
      const session = ctx.get('remote.session' as never) as unknown as { openWorkspacePath(request: { path: string; action?: 'reveal' }): RemoteValue<unknown> } | undefined;
      if (!session) throw new Error('Opening folders is not available here');
      await unwrap(session.openWorkspacePath({ path }));
    },
  };
  const recipeActions = {
    list: () => unwrap(remote().loopRecipes()),
    save: (recipe: { name: string; description?: string; spec: unknown }) => {
      const controller = new AbortController();
      return { result: unwrap(remote().saveLoopRecipe(JSON.stringify(recipe), controller.signal)), cancel: () => controller.abort() };
    },
    remove: (name: string) => unwrap(remote().deleteLoopRecipe(name)),
  };
  function SettingsPage() {
    const active = useLocale();
    // Rendered inside the shell surface, like the preset service, so both services share one frame.
    return withMarkdown(<PixieSettingsPage actions={settingsActions} gateActions={gateActions} recipeActions={recipeActions} locale={active} navFooter={options.navFooter?.(active)} />);
  }
  ctx.slots.inject('local.dsh-studio.services', () => ctx.slots.register({
    name: 'local.dsh-studio.services', id: 'pixie', order: 10, label: () => pixieText(locale(), 'settingsTitle'),
  }, SettingsPage));

  const tabActions = (sessionId: string): PixieTabActions => ({
    view: () => unwrap(remote().view(sessionId)),
    follow: listener => followPixieStream(() => remote().follow(sessionId), listener),
    gateRuns: () => unwrap(remote().gateRuns(sessionId)),
    loopRuns: () => unwrap(remote().loopRuns(sessionId)),
    followGates: listener => followPixieStream(() => remote().followGates(sessionId), listener),
    resolveGateRejection: (runId, status) => unwrap(remote().resolveGateRejection(sessionId, runId, status)),
    sessionGates: () => unwrap(remote().sessionGates(sessionId)),
    setSessionGate: (gateId, enabled) => unwrap(remote().setSessionGate(sessionId, gateId, enabled)),
    fillDraft: text => {
      const sessions = ctx.get('sessions' as never) as unknown as { scope(id: string): { get(name: string): unknown } | undefined } | undefined;
      const actx = sessions?.scope(sessionId);
      const conversation = actx?.get('conversation') as { input: { for(scope: unknown): { setDraft(text: string): void; focus(): void } } } | undefined;
      if (!actx || !conversation) throw new Error('Session composer unavailable');
      const input = conversation.input.for(actx);
      input.setDraft(text);
      input.focus();
    },
    ask: (question, threadId) => unwrap(remote().ask(sessionId, JSON.stringify({ question, ...(threadId ? { threadId } : {}) }))),
    cancel: () => unwrap(remote().cancel(sessionId)),
    createThread: options => unwrap(remote().createThread(sessionId, JSON.stringify(options))),
    activate: threadId => unwrap(remote().activate(sessionId, threadId)),
    deleteThread: threadId => unwrap(remote().deleteThread(sessionId, threadId)),
    models: () => unwrap(remote().models()) as ReturnType<PixieTabActions['models']>,
  });

  // The right sidebar may load after Studio; register the tab and the /pixie row once its services exist.
  ctx.inject(['sidebarRightTabs', 'sidebarRight'] as never, scope => {
    const tabs = (scope as unknown as SidebarServices).sidebarRightTabs;
    const right = (scope as unknown as SidebarServices).sidebarRight;
    scope.effect(() => tabs.register({
      id: TAB_ID, kind: KIND, priority: 'extension', title: () => pixieText(locale(), 'title'),
      guide: [{ id: 'open', order: 60, title: () => pixieText(locale(), 'title'), description: () => pixieText(locale(), 'isolation') }],
    }));
    function Body({ sessionId }: { sessionId: string }) {
      const active = useLocale();
      const actions = React.useMemo(() => tabActions(sessionId), [sessionId]);
      return withMarkdown(<PixieTab actions={actions} locale={active} />);
    }
    scope.slots.inject('sidebar.right.pane.tab' as never, () => scope.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID } as never, Body as never));
    // The /pixie row shows the question, the status line, and a button that opens this tab.
    const openTab = () => { right.openTab(KIND, { revealIfOpened: true }); };
    function CommandRow({ node, sessionId }: { sessionId: string; node: { commandId: string; args: string | null; outcome: { kind: 'success' | 'error'; text?: string } | null } }) {
      const active = useLocale();
      const rowActions = React.useMemo<PixieCommandRowActions>(() => {
        const tab = tabActions(sessionId);
        return { commandId: node.commandId, follow: tab.follow, commandTurn: () => unwrap(remote().commandTurn(sessionId, node.commandId)) };
      }, [sessionId, node.commandId]);
      return withMarkdown(<StudioSurface className="studio-pixie-command">
        <PixieCommandRow question={node.args?.trim() ?? ''} outcome={node.outcome} locale={active} onOpen={openTab} actions={rowActions} />
      </StudioSurface>);
    }
    scope.slots.inject('conversation.chat.commandview' as never, () => scope.slots.register({ name: 'conversation.chat.commandview', key: 'pixie' } as never, CommandRow as never));
    // Under a finished answer: the note a hook script concluded at turn end (translation and similar). Renders nothing otherwise.
    // GateTail mounts this surface (and its stylesheet) only when the turn has a note.
    function GateTailSurface({ children }: React.PropsWithChildren) { return <StudioSurface className="studio-gate-tail">{children}</StudioSurface>; }
    // Every chat row of a session reads one shared gate-run stream.
    const hubs = new Map<string, GateRunSource>();
    const resultActions = (sessionId: string): GateTailActions => {
      let hub = hubs.get(sessionId);
      if (!hub) { const tab = tabActions(sessionId); hub = gateRunHub(tab.gateRuns, tab.followGates); hubs.set(sessionId, hub); }
      return { ...hub, setSessionGate: (gateId, enabled) => unwrap(remote().setSessionGate(sessionId, gateId, enabled)), openTab };
    };
    function TurnTail({ sessionId, turn }: { sessionId: string; turn: { turn: number; status: string } }) {
      const active = useLocale();
      const actions = React.useMemo(() => resultActions(sessionId), [sessionId]);
      if (turn.status !== 'closed') return null;
      return withMarkdown(<GateTail actions={actions} turn={turn.turn} locale={active} Surface={GateTailSurface} />);
    }
    scope.slots.inject('conversation.chat.turnTail' as never, () => scope.slots.register({ name: 'conversation.chat.turnTail', id: 'studio-pixie-gate-tail' } as never, TurnTail as never));
    // Under a tool call or an input message: results of gates at those points. The row is empty until a displayed result exists.
    function GateResultRow({ sessionId, node }: { sessionId: string; node: GateResultNode }) {
      const active = useLocale();
      const actions = React.useMemo(() => resultActions(sessionId), [sessionId]);
      const anchor: GateAnchor = node.data.anchor;
      return withMarkdown(<GateResults actions={actions} anchor={anchor} locale={active} Surface={GateTailSurface} />);
    }
    // The Conversation service may load after Studio; without it the chat shows only turn-end results.
    scope.inject(['uiConversation'] as never, inner => {
      const conversation = (inner as unknown as { uiConversation: { events: { register(definition: unknown): () => void } } }).uiConversation;
      // Registration belongs to this plugin's lifetime and is removed with it.
      conversation.events.register(gateResultDefinition);
      inner.slots.inject('conversation.chat.node' as never, () => inner.slots.register({ name: 'conversation.chat.node', key: GATE_RESULT_NODE } as never, GateResultRow as never));
    });
  });
}
