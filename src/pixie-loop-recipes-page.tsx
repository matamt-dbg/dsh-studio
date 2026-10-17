/** Pixie settings › Loop recipes (#31 S14): list, add from JSON, and delete saved recipes. Node-testable: no host primitives. */
import React from 'react';
import { RECIPE_NAME, type LoopRecipe, type LoopRecipeList } from './pixie-loop-recipes.ts';
import { loopText, type LoopTextKey } from './pixie-loop-locale.ts';
import { Badge, Button, IconButton, Note, Notice, PageHead, SectionHead, SettingsRow } from './ui.tsx';

export interface LoopRecipeActions {
  list(): Promise<LoopRecipeList>;
  save(recipe: { name: string; description?: string; spec: unknown }): { result: Promise<LoopRecipe>; cancel(): void };
  remove(name: string): Promise<LoopRecipeList>;
}

const TrashIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
/** Starter spec for the editor; a criteria review that `validateRecipeSpec` accepts. */
export const EXAMPLE_RECIPE_SPEC = JSON.stringify({
  work: { instruction: 'Translate the input into Korean.' },
  criteria: 'The output is natural Korean with the same meaning as the input.',
  calibration: { pass: [{ input: 'Save', output: '저장' }], fail: [{ input: 'Save', output: 'Save' }] },
  limits: { tokens: 200000, timeMs: 600000 },
  maxAttempts: 2,
}, null, 2);
const kind = (recipe: LoopRecipe): LoopTextKey => recipe.spec.select ? 'kindSelect' : recipe.spec.act ? 'kindAct' : 'kindReview';

export function LoopRecipesPage({ actions, locale }: { actions: LoopRecipeActions; locale: string }) {
  const t = (key: LoopTextKey, values?: Record<string, string | number>) => loopText(locale, key, values);
  const [list, setList] = React.useState<LoopRecipeList>();
  const [error, setError] = React.useState('');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [spec, setSpec] = React.useState('');
  const [saving, setSaving] = React.useState<{ cancel(): void }>();
  const [saveError, setSaveError] = React.useState('');
  const [saved, setSaved] = React.useState('');
  const load = React.useCallback(async () => {
    try { setList(await actions.list()); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [actions]);
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => () => saving?.cancel(), [saving]);
  const save = () => {
    setSaveError(''); setSaved('');
    let parsed: unknown;
    try { parsed = JSON.parse(spec); } catch { setSaveError(t('specJson')); return; }
    const call = actions.save({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), spec: parsed });
    setSaving({ cancel: call.cancel });
    call.result.then(recipe => { setSaving(undefined); setSaved(t('recipeSaved', { name: recipe.name })); setName(''); setDescription(''); setSpec(''); void load(); },
      cause => { setSaving(undefined); setSaveError(cause instanceof Error ? cause.message : String(cause)); });
  };
  const remove = async (recipeName: string) => {
    try { setList(await actions.remove(recipeName)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const trimmedName = name.trim();
  const nameInvalid = !!trimmedName && !RECIPE_NAME.test(trimmedName);
  const replaces = !nameInvalid && !!list?.recipes.some(recipe => recipe.name === trimmedName);
  const canSave = !!trimmedName && !nameInvalid && !!spec.trim();
  const hasEntries = !!list && (list.recipes.length > 0 || list.invalid.length > 0);
  return <div className="studio-page-stack">
    <PageHead title={t('recipes')} description={t('recipesDescription')} />
    {error && <Notice action={<Button small onClick={() => { void load(); }}>{t('refresh')}</Button>}>{error}</Notice>}
    {list && !hasEntries && <Note>{t('noRecipes')}</Note>}
    {hasEntries && <section className="studio-settings-card" aria-label={t('recipes')}>
      {list.invalid.map(item => <Notice key={item.index}>{t('invalidRecipe', { index: item.index + 1 })}: {item.error}</Notice>)}
      {list.recipes.map(recipe => <SettingsRow key={recipe.name} title={<span className="studio-inline-actions"><code>{recipe.name}</code><Badge tone="outline">{t(kind(recipe))}</Badge></span>}
        description={[recipe.description, recipe.checks ? t('recipeChecks', { count: Object.keys(recipe.checks.questions).length }) : t('recipeNoChecks')].filter(Boolean).join(' · ')}
        control={<IconButton label={t('deleteRecipe', { name: recipe.name })} tone="error" onClick={() => { void remove(recipe.name); }}><TrashIcon /></IconButton>} />)}
    </section>}
    <SectionHead title={t('addRecipe')} />
    <section className="studio-settings-card" aria-label={t('addRecipe')}>
      <SettingsRow title={t('recipeName')} description={nameInvalid ? <span className="studio-pixie-error">{t('recipeNameInvalid')}</span> : t('recipeNameHint')}
        control={<input aria-label={t('recipeName')} aria-invalid={nameInvalid || undefined} placeholder="ko-review" spellCheck={false} autoComplete="off" value={name} disabled={!!saving} onChange={event => setName(event.target.value)} />} />
      <SettingsRow title={t('recipeDescription')} description={t('recipeDescriptionHint')}
        control={<input aria-label={t('recipeDescription')} value={description} disabled={!!saving} onChange={event => setDescription(event.target.value)} />} />
      <SettingsRow title={t('recipeSpec')} description={t('recipeSpecHint')}
        control={<Button small disabled={!!saving} onClick={() => { setSpec(EXAMPLE_RECIPE_SPEC); setSaveError(''); }}>{t('insertExample')}</Button>}>
        <textarea className="studio-loop-spec" aria-label={t('recipeSpec')} placeholder={EXAMPLE_RECIPE_SPEC} spellCheck={false} value={spec} rows={14} disabled={!!saving} onChange={event => setSpec(event.target.value)} />
      </SettingsRow>
      {saveError && <Notice>{saveError}</Notice>}
      <div className="studio-card-footer">
        {saving ? <span role="status" className="studio-muted">{t('recipeSaving')}</span>
          : saved ? <span role="status" className="studio-muted">{saved}</span>
          : !canSave ? <span className="studio-muted">{t('saveRecipeNeeds')}</span>
          : replaces ? <span className="studio-muted">{t('recipeReplaces', { name: trimmedName })}</span> : null}
        <span className="studio-card-footer-end studio-inline-actions">
          {saving ? <Button onClick={() => { saving.cancel(); setSaving(undefined); }}>{t('cancelSave')}</Button>
            : <Button primary disabled={!canSave} onClick={save}>{t('saveRecipe')}</Button>}
        </span>
      </div>
    </section>
  </div>;
}
