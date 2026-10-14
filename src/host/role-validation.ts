import type { Context } from '@deepseek-ai/cordis';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { StudioRole } from '../role-settings.ts';

/** Validate exact routes through the owning adapter, not advisory catalog membership. */
export async function validateRoleModel(llm: Context['llm'] | undefined, role: StudioRole, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (role.model === 'inherit') return;
  if (!llm) throw new Error('Studio role model validation unavailable: LLM service is not mounted.');
  const slash = role.model.indexOf('/');
  const provider = role.model.slice(0, slash);
  const model = role.model.slice(slash + 1);
  if (!llm.listProviders().some(item => item.id === provider)) {
    throw new Error(`Studio role "${role.role}": provider "${provider}" is not registered. Select an available model in Studio, save and reapply the preset.`);
  }
  try {
    await llm.resolveCallConfig({ provider, model,
      ...(role.reasoning === 'inherit' ? {} : { reasoningEffort: ReasoningEffortId(role.reasoning) }),
    }, signal);
  } catch {
    signal?.throwIfAborted();
    // Adapter errors may contain endpoint/credential details; do not relay them.
    throw new Error(`Studio role "${role.role}": could not validate model "${role.model}" and reasoning settings. Check provider availability and model settings, then retry. No child was started.`);
  }
  signal?.throwIfAborted();
}
