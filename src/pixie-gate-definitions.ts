export interface GateTasksRead {
  entries: import('./pixie-gate-task.ts').GateTask[];
  invalid: InvalidGateEntry[];
  error?: GateDefinitionError;
}
export interface GateDefinitionError { code: string; message: string }
export interface InvalidGateEntry { index: number; raw: unknown; error: GateDefinitionError }
