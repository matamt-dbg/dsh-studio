/**
 * Korean dictionaries for DSH's own Client namespaces (#30). Studio adds the `ko` language in
 * shell.tsx; this module registers one `ko` dictionary per DSH namespace through the public
 * `locale.register(ns, 'ko', dict)` and checks dictionaries against extracted DSH sources.
 */

/** One namespace's Korean dictionary. */
export interface DshKoNamespace {
  /** Key → Korean text. Placeholders such as `{name}` match the English source. */
  readonly ko: Readonly<Record<string, string>>;
  /** Keys deliberately left to the English fallback (judge did not pass them). */
  readonly fallback?: readonly string[];
}

export type DshKoDictionaries = Readonly<Record<string, DshKoNamespace>>;

/** The part of the locale service this module uses (present in DSH 0.2.0-rc.2 and 0.2.1-alpha.2). */
export interface KoLocaleRegistry {
  register(ns: string, locale: string, dict: Record<string, string>): () => void;
}

/** A namespace whose `ko` registration was refused, typically because DSH already ships `ko`. */
export interface KoRegistrationFailure { readonly ns: string; readonly error: unknown }

/**
 * Register every namespace's `ko` dictionary. A refusal for one namespace is reported and
 * leaves the others registered.
 * @returns disposer removing every dictionary this call registered (idempotent).
 */
export function registerDshKo(
  locale: KoLocaleRegistry,
  dictionaries: DshKoDictionaries,
  onFailure: (failure: KoRegistrationFailure) => void = () => {},
): () => void {
  const disposers: (() => void)[] = [];
  for (const [ns, { ko }] of Object.entries(dictionaries)) {
    if (Object.keys(ko).length === 0) continue;
    try {
      disposers.push(locale.register(ns, 'ko', { ...ko }));
    } catch (error) {
      onFailure({ ns, error });
    }
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) dispose();
  };
}

/** Extracted source shape written by studio/scripts/extract-dsh-locale.mjs. */
export interface DshLocaleSource {
  readonly ref?: string;
  readonly namespaces: Readonly<Record<string, { readonly keys: Readonly<Record<string, { readonly en?: string; readonly zh?: string }>> }>>;
}

export interface KoNamespaceReport {
  readonly ns: string;
  /** Source keys neither translated nor listed as fallback. */
  readonly missing: readonly string[];
  /** Dictionary or fallback keys absent from the source. */
  readonly extra: readonly string[];
  /** Keys whose `{...}` placeholders differ from the English source. */
  readonly placeholders: readonly string[];
}

export interface KoCheckReport {
  readonly source?: string;
  /** Namespaces with a dictionary that this source has, each with its findings. */
  readonly namespaces: readonly KoNamespaceReport[];
  /** Dictionary namespaces absent from this source. */
  readonly unknownNamespaces: readonly string[];
  /** Source namespaces without a dictionary yet. */
  readonly untranslated: readonly string[];
  /** No missing or placeholder findings. Extra keys may belong to another supported version. */
  readonly ok: boolean;
}

const placeholderSet = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');

/** Compare dictionaries with one extracted DSH source. Untranslated namespaces are listed, not failed. */
export function checkDshKo(dictionaries: DshKoDictionaries, source: DshLocaleSource): KoCheckReport {
  const namespaces: KoNamespaceReport[] = [];
  const unknownNamespaces: string[] = [];
  for (const [ns, { ko, fallback = [] }] of Object.entries(dictionaries)) {
    const keys = source.namespaces[ns]?.keys;
    if (keys === undefined) { unknownNamespaces.push(ns); continue; }
    const covered = new Set([...Object.keys(ko), ...fallback]);
    namespaces.push({
      ns,
      missing: Object.keys(keys).filter(key => !covered.has(key)),
      extra: [...covered].filter(key => !(key in keys)),
      placeholders: Object.entries(ko).filter(([key, text]) => {
        const en = keys[key]?.en;
        return en !== undefined && placeholderSet(en) !== placeholderSet(text);
      }).map(([key]) => key),
    });
  }
  const untranslated = Object.keys(source.namespaces).filter(ns => !(ns in dictionaries));
  const ok = namespaces.every(report => report.missing.length + report.placeholders.length === 0);
  return { ...source.ref === undefined ? {} : { source: source.ref }, namespaces, unknownNamespaces, untranslated, ok };
}

export interface KoSupportReport {
  readonly reports: readonly KoCheckReport[];
  /** Namespaces no supported source has. */
  readonly strayNamespaces: readonly string[];
  /** `ns.key` entries no supported source has. */
  readonly strayKeys: readonly string[];
  readonly ok: boolean;
}

/**
 * Check dictionaries against every supported DSH source. Each source must have no missing or
 * placeholder findings; a namespace or key is stray only when no source has it.
 */
export function checkDshKoSupport(dictionaries: DshKoDictionaries, sources: readonly DshLocaleSource[]): KoSupportReport {
  const reports = sources.map(source => checkDshKo(dictionaries, source));
  const strayNamespaces = Object.keys(dictionaries).filter(ns => sources.every(source => !(ns in source.namespaces)));
  const strayKeys = Object.entries(dictionaries)
    .filter(([ns]) => !strayNamespaces.includes(ns))
    .flatMap(([ns, { ko, fallback = [] }]) => [...new Set([...Object.keys(ko), ...fallback])]
      .filter(key => sources.every(source => !(key in (source.namespaces[ns]?.keys ?? {}))))
      .map(key => `${ns}.${key}`));
  return { reports, strayNamespaces, strayKeys, ok: reports.every(report => report.ok) && strayNamespaces.length === 0 && strayKeys.length === 0 };
}
