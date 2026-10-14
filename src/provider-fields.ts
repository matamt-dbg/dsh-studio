export interface ProviderField { key: string; type: 'string' | 'number' | 'boolean' | 'string[]'; value?: unknown; minimum?: number; options?: string[] }
const field = (key: string, type: ProviderField['type'], value?: unknown, minimum?: number): ProviderField => ({ key, type, ...(value === undefined ? {} : { value }), ...(minimum === undefined ? {} : { minimum }) });
/** Explicit public Config surface, shared by validation and property editors. */
export const providerFields: Record<string, ProviderField[]> = {
  '@deepseek-ai/dsh-compaction-basic': [field('thresholdRatio','number',0.8,0),field('headroomTokens','number',65536,1),field('retainRatio','number',0.16,0),field('retainTokens','number',undefined,0),field('summarizationProvider','string',''),field('summarizationModel','string',''),field('maxTokens','number',undefined,1),field('compactionRetries','number',1,0),field('maxOverflowRetries','number',1,0),field('auto','boolean',true)],
  '@deepseek-ai/dsh-compaction-tool-result-pruner': [field('thresholdChars','number',8192,1),field('headChars','number',4096,0),field('tailChars','number',1024,0)],
  '@deepseek-ai/dsh-agent-tool-presentation': [{key:'mode',type:'string',options:['native','ptc']}],
  '@deepseek-ai/dsh-persona': [field('prefix','string'),field('suffix','string',''),field('includeRuntimeContext','boolean',true)],
  '@deepseek-ai/dsh-agent-instructions': [field('maxBytes','number',65536), field('maxSourceBytes','number',undefined,1), field('projectRootMarkers','string[]'),field('instructionFileCandidates','string[]'),field('localInstructionFileCandidates','string[]')],
  '@deepseek-ai/dsh-time-context': [field('timeZone','string'),field('refreshIntervalMs','number',undefined,0)],
  '@deepseek-ai/dsh-skill-filesystem': [field('providerName','string','filesystem'),field('includeDefaultRoots','boolean',true),field('dshHome','string'),field('agentsHome','string'),field('customSkillDirs','string[]',[]),field('bundledSkillDir','string'),field('watch','boolean',true),field('watchUsePolling','boolean',false),field('watchStabilityThresholdMs','number',200,0),field('watchPollIntervalMs','number',100,1),field('watchMaxProjects','number',128,1),field('watchFollowSymlinks','boolean',true)],
};
