/** Partial object overrides change only the leaves they actually specify. */
export function hasChangedOverride(base: unknown, override: unknown): boolean {
  if (override === undefined) return false;
  if (override !== null && typeof override === 'object' && !Array.isArray(override)) {
    const source = base !== null && typeof base === 'object' ? base as Record<string, unknown> : {};
    return Object.entries(override).some(([key, value]) => hasChangedOverride(source[key], value));
  }
  return JSON.stringify(base) !== JSON.stringify(override);
}
export { ChangeIndicator } from './ui.tsx';
