/** Saved Pixie Loop recipes (#31 S14): a spec without items, with checks compiled and calibrated when saved.
 * The tool, gates, and the hook helper run a recipe by name. No Host or Client runtime dependencies.
 */
import { validateLoopChecks, validateLoopSpec, type LoopChecks, type LoopSpec } from './pixie-loop-contracts.ts';

/** A recipe is a loop spec without items or output; those come from the caller. */
export type RecipeSpec = Omit<LoopSpec, 'items' | 'output'>;
export interface LoopRecipe {
  name: string;
  description?: string;
  spec: RecipeSpec;
  /** Checks fixed at save time; absent for a plain pick-once selection. */
  checks?: LoopChecks;
  compiledBy?: 'pixie' | 'spec';
  savedAt: number;
}
export interface LoopRecipeList { recipes: LoopRecipe[]; invalid: { index: number; error: string }[] }

export const RECIPE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate a recipe spec as a full spec with one placeholder item. */
export function validateRecipeSpec(raw: unknown): RecipeSpec {
  if (!object(raw)) throw new Error('Recipe spec must be an object');
  if ('items' in raw || 'output' in raw) throw new Error('A recipe has no items or output; callers give them');
  const { items: _items, output: _output, ...spec } = validateLoopSpec({ ...raw, items: { inline: [{ id: 'recipe', input: 'recipe' }] } });
  return spec;
}

export function validateRecipe(raw: unknown): LoopRecipe {
  if (!object(raw)) throw new Error('Recipe must be an object');
  for (const key of Object.keys(raw)) if (!['name', 'description', 'spec', 'checks', 'compiledBy', 'savedAt'].includes(key)) throw new Error(`Unknown field in recipe: ${key}`);
  if (typeof raw.name !== 'string' || !RECIPE_NAME.test(raw.name)) throw new Error('Recipe name must be 1–64 lowercase letters, digits, or -');
  if (raw.description !== undefined && typeof raw.description !== 'string') throw new Error('Recipe description must be a string');
  const spec = validateRecipeSpec(raw.spec);
  const reviewed = spec.criteria !== undefined || spec.checks !== undefined;
  if (reviewed && raw.checks === undefined) throw new Error('Recipe checks are missing; save the recipe through Studio so they are compiled and calibrated');
  const checks = raw.checks === undefined ? undefined : validateLoopChecks(raw.checks);
  if (raw.compiledBy !== undefined && raw.compiledBy !== 'pixie' && raw.compiledBy !== 'spec') throw new Error('Recipe compiledBy must be pixie or spec');
  if (typeof raw.savedAt !== 'number') throw new Error('Recipe savedAt must be a number');
  return { name: raw.name, ...(raw.description ? { description: raw.description } : {}), spec, ...(checks ? { checks } : {}), ...(raw.compiledBy ? { compiledBy: raw.compiledBy as 'pixie' | 'spec' } : {}), savedAt: raw.savedAt };
}

/** Rebuild a runnable spec from a recipe and caller items. */
export function recipeSpec(recipe: LoopRecipe, items: LoopSpec['items'], output?: string): LoopSpec {
  return { ...structuredClone(recipe.spec), items, ...(output ? { output } : {}) };
}
