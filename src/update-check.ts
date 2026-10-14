/** Studio self-update: pick the newest published release the running DSH accepts. Shared by Host and Client. */

/** What the Studio status bar shows about the installed and published versions. */
export interface UpdateStatus {
  /** Version of the running Studio build. */
  current: string;
  /** Version on disk when it differs from `current`: installed, waiting for a DSH restart. */
  installed?: string;
  /** Running DSH version, when the Host could read it. */
  runtimeVersion?: string;
  /** The registry's `latest` tag, whatever DSH it supports. */
  latest?: string;
  /** Newest stable release newer than `current` whose DSH peers accept the running DSH. */
  available?: string;
  /** `latest` when it is newer than `current` but rejects the running DSH. */
  incompatibleLatest?: string;
  /** Why Studio cannot install the update itself; absent when it can. */
  blocked?: 'no-plugin-manager' | 'not-profile-dependency';
  /** How this profile declares Studio, e.g. `^0.2.7` or `file:…`; absent when the profile does not. */
  source?: string;
  /** Registry lookup failure; the other fields still describe the local install. */
  error?: string;
}

/** Outcome of one update request. */
export interface UpdateResult {
  status: 'restart-required' | 'applied' | 'failed' | 'cancelled';
  version: string;
  message?: string;
}

/** The part of a registry packument this check reads. */
export interface RegistryDocument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, { name?: string; version?: string; peerDependencies?: Record<string, string>; deprecated?: string }>;
}

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Compare two stable versions; non-stable versions sort below every stable one. */
export function compareStable(a: string, b: string): number {
  const x = STABLE.exec(a); const y = STABLE.exec(b);
  if (!x || !y) return Number(Boolean(x)) - Number(Boolean(y));
  for (let i = 1; i <= 3; i++) {
    const diff = Number(x[i]) - Number(y[i]);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** Whether `candidate` is a stable release newer than `current`. A prerelease current compares by its core. */
export function isNewer(candidate: string, current: string): boolean {
  return STABLE.test(candidate) && compareStable(candidate, current.split('-')[0]!) > 0;
}

/**
 * Choose what the status bar offers.
 * @param document Registry packument (abbreviated metadata suffices).
 * @param current Running Studio version.
 * @param compatible Whether a version manifest's DSH peers accept the running DSH.
 * @returns The newest compatible newer release and the `latest` tag when it is newer but incompatible.
 */
export function pickUpdate(document: RegistryDocument, current: string, compatible: (manifest: object) => boolean): Pick<UpdateStatus, 'latest' | 'available' | 'incompatibleLatest'> {
  const latest = document['dist-tags']?.latest;
  const candidates = Object.entries(document.versions ?? {})
    .filter(([version, manifest]) => isNewer(version, current) && !manifest.deprecated)
    .sort(([a], [b]) => compareStable(b, a));
  const available = candidates.find(([, manifest]) => compatible(manifest))?.[0];
  const incompatibleLatest = latest !== undefined && isNewer(latest, current) && latest !== available
    && candidates.some(([version]) => version === latest) ? latest : undefined;
  return { ...(latest ? { latest } : {}), ...(available ? { available } : {}), ...(incompatibleLatest ? { incompatibleLatest } : {}) };
}

/** Registry document URL for a scoped or unscoped package name. */
export function packumentUrl(registry: string, name: string): string {
  return `${registry.replace(/\/+$/, '')}/${name.replace('/', '%2f')}`;
}
