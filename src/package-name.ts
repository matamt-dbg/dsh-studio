/** Published npm name of the Studio plugin. Host entry points are subpaths of it. */
export const PACKAGE_NAME = '@matamt-dbg/dsh-studio';
/** Name used before publication; applied preset snapshots written by older builds still reference it. */
export const LEGACY_PACKAGE_NAME = '@local/dsh-studio-shell';
export const POLICY_PLUGIN = `${PACKAGE_NAME}/policy`;
export const ROLE_PLUGIN = `${PACKAGE_NAME}/roles`;
export const BATCH_PLUGIN = `${PACKAGE_NAME}/batch`;
export const JUDGE_PLUGIN = `${PACKAGE_NAME}/judge`;
export const LOOP_PLUGIN = `${PACKAGE_NAME}/loop`;

/** Rewrite a Loader entry name from the pre-publication package to the published one. */
export function currentPluginName(name: string): string {
  return name === LEGACY_PACKAGE_NAME || name.startsWith(`${LEGACY_PACKAGE_NAME}/`) ? PACKAGE_NAME + name.slice(LEGACY_PACKAGE_NAME.length) : name;
}
/** Kept equal to packages/shell/package.json "version" (checked by test). */
export const STUDIO_VERSION = '0.6.1';
