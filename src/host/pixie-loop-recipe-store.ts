/** Pixie Loop recipes on disk (#31 S14): `<profile>/studio-data/pixie-loop/recipes.json`.
 * Saving compiles and calibrates checks once; runs reuse them without recompiling.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyUsage } from '../pixie-loop-contracts.ts';
import { recipeSpec, validateRecipe, validateRecipeSpec, RECIPE_NAME, type LoopRecipe, type LoopRecipeList } from '../pixie-loop-recipes.ts';
import { calibrate, compileChecks, type LoopEngineDeps } from './pixie-loop-engine.ts';

export class PixieLoopRecipes {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async read(): Promise<LoopRecipeList> {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { recipes: [], invalid: [] };
      return { recipes: [], invalid: [{ index: -1, error: error instanceof Error ? error.message : String(error) }] };
    }
    const list: LoopRecipeList = { recipes: [], invalid: [] };
    const rows = (raw as { recipes?: unknown })?.recipes;
    if (!Array.isArray(rows)) return { recipes: [], invalid: [{ index: -1, error: 'recipes.json needs a recipes array' }] };
    rows.forEach((row, index) => {
      try { const recipe = validateRecipe(row); if (list.recipes.some(item => item.name === recipe.name)) throw new Error(`Duplicate recipe name: ${recipe.name}`); list.recipes.push(recipe); }
      catch (error) { list.invalid.push({ index, error: error instanceof Error ? error.message : String(error) }); }
    });
    return list;
  }

  async get(name: string): Promise<LoopRecipe> {
    const recipe = (await this.read()).recipes.find(item => item.name === name);
    if (!recipe) throw new Error(`Unknown Pixie Loop recipe: ${name}. Save it in DSH Studio → Pixie → Loop recipes`);
    return recipe;
  }

  /** Validate, compile and calibrate checks once, then store. A failed calibration stores nothing. */
  async save(raw: { name?: unknown; description?: unknown; spec?: unknown }, deps: LoopEngineDeps, signal: AbortSignal): Promise<LoopRecipe> {
    if (typeof raw.name !== 'string' || !RECIPE_NAME.test(raw.name)) throw new Error('Recipe name must be 1–64 lowercase letters, digits, or -');
    if (raw.description !== undefined && typeof raw.description !== 'string') throw new Error('Recipe description must be a string');
    const spec = validateRecipeSpec(raw.spec);
    const reviewed = spec.criteria !== undefined || spec.checks !== undefined;
    let recipe: LoopRecipe = { name: raw.name, ...(raw.description ? { description: raw.description } : {}), spec, savedAt: Date.now() };
    if (reviewed) {
      if (!deps.model && spec.criteria !== undefined) throw new Error('No Pixie model is configured in Studio settings');
      if (!deps.judge) throw new Error('No decision engine is configured');
      const full = recipeSpec(recipe, { inline: [{ id: 'recipe', input: 'recipe' }] });
      const checks = await compileChecks(full, deps, signal, emptyUsage());
      await calibrate(checks, full, deps, signal, emptyUsage());
      recipe = { ...recipe, checks, compiledBy: spec.checks ? 'spec' : 'pixie' };
    }
    validateRecipe(recipe);
    await this.update(list => [...list.filter(item => item.name !== recipe.name), recipe]);
    return recipe;
  }

  remove(name: string): Promise<void> { return this.update(list => list.filter(item => item.name !== name)).then(() => {}); }

  private update(change: (list: LoopRecipe[]) => LoopRecipe[]): Promise<LoopRecipe[]> {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = change((await this.read()).recipes).sort((a, b) => a.name.localeCompare(b.name));
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify({ recipes: next }, null, 2)); await rename(temporary, this.file); }
      finally { await rm(temporary, { force: true }); }
      return next;
    });
    this.writes = operation;
    return operation;
  }
}
