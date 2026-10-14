import { toolPromptSections } from './tool-prompt-sections.ts';
export interface CatalogTool { name: string; description: string; parameters?: Record<string, unknown>; promptSections?: CatalogSection[] }
export interface CatalogSection { name: string; text: string }
export interface CatalogPreset { promptProviders?: import('./prompt-composition.ts').PromptProvider[]; id: string; name?: string | undefined; sections: CatalogSection[]; tools: CatalogTool[]; declaration?: string; error?: string }
export interface PresetCatalog { plugins?: import('./plugin-catalog.ts').PluginCatalogEntry[]; presets: CatalogPreset[]; tools: CatalogTool[]; execution?: import('./execution-capabilities.ts').ExecutionCapabilities }
export interface CatalogServices {
  agentPresets: {
    list(): Promise<{ id: string; name?: string }[]>;
    readDocument(id: string): Promise<{ content: string }>;
    acquireScope(id: string): Promise<{ key: object; [Symbol.asyncDispose](): Promise<void> }>;
  };
  systemPrompt: { assemble(context: { scope: object }): Promise<{ sections: CatalogSection[]; tools: CatalogTool[] }> };
  tools: { schemas(scope?: object): CatalogTool[] };
}
/** Startup snapshot: never mounts presets or executes prompt contributors. */
export async function readStartupCatalog(services: Pick<CatalogServices, 'agentPresets' | 'tools'>): Promise<PresetCatalog> {
  const tools = structuredClone(services.tools.schemas());
  const presets: CatalogPreset[] = [];
  for (const preset of await services.agentPresets.list()) {
    try {
      const declaration = (await services.agentPresets.readDocument(preset.id)).content;
      presets.push({ ...preset, declaration, sections: [], tools: [] });
    } catch (error) {
      presets.push({ ...preset, sections: [], tools: [], error: String(error) });
    }
  }
  return { presets, tools: tools.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Read registered contributions, not plugin-name guesses or source-file snapshots. */
export async function readPresetCatalog(services: CatalogServices): Promise<PresetCatalog> {
  const all = new Map(services.tools.schemas().map(tool => [tool.name, { name: tool.name, description: tool.description, ...(tool.parameters ? { parameters: tool.parameters } : {}) }]));
  const presets: CatalogPreset[] = [];
  for (const preset of await services.agentPresets.list()) {
    let lease: Awaited<ReturnType<CatalogServices['agentPresets']['acquireScope']>> | undefined;
    try {
      lease = await services.agentPresets.acquireScope(preset.id);
      const assembly = await services.systemPrompt.assemble({ scope: lease.key });
      for (const tool of [...services.tools.schemas(lease.key), ...assembly.tools]) all.set(tool.name, { name: tool.name, description: tool.description, ...(tool.parameters ? { parameters: tool.parameters } : {}) });
      const declaration = (await services.agentPresets.readDocument(preset.id)).content;
      const tools = new Map([...services.tools.schemas(lease.key), ...assembly.tools].map(({ name, description, parameters }) => [name, { name, description, ...(parameters ? { parameters } : {}) }]));
      presets.push({ id: preset.id, name: preset.name, declaration, sections: assembly.sections.map(({ name, text }) => ({ name, text })), tools: [...tools.values()] });
    } catch (error) {
      presets.push({ id: preset.id, name: preset.name, sections: [], tools: [], error: String(error) });
    } finally { await lease?.[Symbol.asyncDispose](); }
  }
  const sections = new Map(presets.flatMap(preset => preset.sections).map(section => [section.name, section]));
  return { presets, tools: [...all.values()].map(tool => ({ ...tool, promptSections: (toolPromptSections[tool.name] ?? []).flatMap(name => sections.has(name) ? [sections.get(name)!] : []) })).sort((a, b) => a.name.localeCompare(b.name)) };
}
export function mergePresetTools(manual: string[], presets: CatalogPreset[], active: string[], excluded: string[] = []): string[] {
  return [...new Set([...manual, ...presets.filter(p => active.includes(p.id)).flatMap(p => p.tools.map(t => t.name))])].filter(name => !excluded.includes(name));
}
