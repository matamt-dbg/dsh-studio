/**
 * Korean dictionaries for DSH namespaces, one file per namespace (`./<namespace>.ts`).
 * The translation skill adds a file and one line here per finished namespace.
 */
import type { DshKoDictionaries } from '../dsh-ko-locale.ts';
import agentTeam from './agent-team.ts';
import approval from './approval.ts';
import chat from './chat.ts';
import claudeCodeMods from './claude-code-mods.ts';
import command from './command.ts';
import common from './common.ts';
import conversation from './conversation.ts';
import cordis from './cordis.ts';
import cotTranslation from './cotTranslation.ts';
import deliverables from './deliverables.ts';
import directoryBrowser from './directory-browser.ts';
import documentHtml from './documentHtml.ts';
import documentMarkdown from './documentMarkdown.ts';
import feedback from './feedback.ts';
import goal from './goal.ts';
import inspectorPanel from './inspectorPanel.ts';
import job from './job.ts';
import model from './model.ts';
import openInApp from './open-in-app.ts';
import permissionAccess from './permission.access.ts';
import plan from './plan.ts';
import pluginManager from './pluginManager.ts';
import pluginMarket from './pluginMarket.ts';
import question from './question.ts';
import reference from './reference.ts';
import scheduleCatalog from './schedule.catalog.ts';
import scheduleManager from './schedule.manager.ts';
import secretMask from './secretMask.ts';
import sessionInspector from './session-inspector.ts';
import sessionLogDownload from './session-log-download.ts';
import settings from './settings.ts';
import settingsAccount from './settings.account.ts';
import settingsAgentLoop from './settings.agentLoop.ts';
import settingsAgentPreset from './settings.agentPreset.ts';
import settingsLocale from './settings.locale.ts';
import settingsModels from './settings.models.ts';
import settingsPermission from './settings.permission.ts';
import settingsPluginInventory from './settings.pluginInventory.ts';
import settingsPlugins from './settings.plugins.ts';
import settingsSessionLog from './settings.sessionLog.ts';
import settingsShell from './settings.shell.ts';
import settingsSubagent from './settings.subagent.ts';
import settingsTheme from './settings.theme.ts';
import settingsWebSearch from './settings.webSearch.ts';
import shortcuts from './shortcuts.ts';
import shortcutsLayout from './shortcuts.layout.ts';
import sidebar from './sidebar.ts';
import sidebarBrowser from './sidebarBrowser.ts';
import sidebarCodePreview from './sidebarCodePreview.ts';
import sidebarDocumentPreview from './sidebarDocumentPreview.ts';
import sidebarExcel from './sidebarExcel.ts';
import sidebarFiles from './sidebarFiles.ts';
import sidebarImage from './sidebarImage.ts';
import sidebarOffice from './sidebarOffice.ts';
import sidebarPdf from './sidebarPdf.ts';
import sidebarRight from './sidebarRight.ts';
import sidebarTerminal from './sidebarTerminal.ts';
import skill from './skill.ts';
import slashMenu from './slash.menu.ts';
import subagent from './subagent.ts';
import trajectory from './trajectory.ts';
import voiceInput from './voice-input.ts';
import workflowRun from './workflowRun.ts';
import workspace from './workspace.ts';

export const dshKo: DshKoDictionaries = {
  'agent-team': agentTeam,
  approval: approval,
  chat: chat,
  'claude-code-mods': claudeCodeMods,
  command: command,
  common: common,
  conversation: conversation,
  cordis: cordis,
  cotTranslation: cotTranslation,
  deliverables: deliverables,
  'directory-browser': directoryBrowser,
  documentHtml: documentHtml,
  documentMarkdown: documentMarkdown,
  feedback: feedback,
  goal: goal,
  inspectorPanel: inspectorPanel,
  job: job,
  model: model,
  'open-in-app': openInApp,
  'permission.access': permissionAccess,
  plan: plan,
  pluginManager: pluginManager,
  pluginMarket: pluginMarket,
  question: question,
  reference: reference,
  'schedule.catalog': scheduleCatalog,
  'schedule.manager': scheduleManager,
  secretMask: secretMask,
  'session-inspector': sessionInspector,
  'session-log-download': sessionLogDownload,
  settings: settings,
  'settings.account': settingsAccount,
  'settings.agentLoop': settingsAgentLoop,
  'settings.agentPreset': settingsAgentPreset,
  'settings.locale': settingsLocale,
  'settings.models': settingsModels,
  'settings.permission': settingsPermission,
  'settings.pluginInventory': settingsPluginInventory,
  'settings.plugins': settingsPlugins,
  'settings.sessionLog': settingsSessionLog,
  'settings.shell': settingsShell,
  'settings.subagent': settingsSubagent,
  'settings.theme': settingsTheme,
  'settings.webSearch': settingsWebSearch,
  shortcuts: shortcuts,
  'shortcuts.layout': shortcutsLayout,
  sidebar: sidebar,
  sidebarBrowser: sidebarBrowser,
  sidebarCodePreview: sidebarCodePreview,
  sidebarDocumentPreview: sidebarDocumentPreview,
  sidebarExcel: sidebarExcel,
  sidebarFiles: sidebarFiles,
  sidebarImage: sidebarImage,
  sidebarOffice: sidebarOffice,
  sidebarPdf: sidebarPdf,
  sidebarRight: sidebarRight,
  sidebarTerminal: sidebarTerminal,
  skill: skill,
  'slash.menu': slashMenu,
  subagent: subagent,
  trajectory: trajectory,
  'voice-input': voiceInput,
  workflowRun: workflowRun,
  workspace: workspace,
};
