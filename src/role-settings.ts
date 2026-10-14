/** Persisted editor shape. Legacy overrides are retained as data, never executed. */
export interface StudioRole {
  name: string; role: string; model: string; reasoning: string;
  spawn: 'fresh' | 'fork'; persona: string; overrides?: unknown;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function parseRoles(input: unknown): StudioRole[] {
  if (!Array.isArray(input) || input.length > 50) throw new Error('Studio agents must be an array of at most 50 roles');
  const seen = new Set<string>();
  return input.map(value => {
    if (!object(value)) throw new Error('Invalid Studio role');
    const text = (key: string, fallback: string, max: number) => {
      const v = value[key] ?? fallback;
      if (typeof v !== 'string' || v.length > max) throw new Error(`Invalid role ${key}`);
      return key === 'persona' ? v : v.trim();
    };
    const name = text('name', '', 120);
    // Name-only rows from the old editor migrate without dropping saved data.
    const role = text('role', name, 120);
    const model = text('model', 'inherit', 512);
    const reasoning = text('reasoning', 'inherit', 120);
    const spawn = text('spawn', 'fresh', 10);
    const persona = text('persona', '', 32000);
    if (!name || !role || seen.has(role)) throw new Error('Role names and unique role identifiers are required');
    if (model !== 'inherit' && !/^[^\s/]+\/\S+$/.test(model)) throw new Error('Role model must be inherit or provider/model');
    if (!/^[a-zA-Z0-9_-]+$/.test(reasoning)) throw new Error('Role reasoning must be inherit or an effort identifier');
    if (spawn !== 'fresh' && spawn !== 'fork') throw new Error('Role spawn must be fresh or fork');
    seen.add(role);
    return { name, role, model, reasoning, spawn, persona, ...('overrides' in value ? { overrides: structuredClone(value.overrides) } : {}) };
  });
}
/** Strict allowlist crossing the stored-data → executable-config boundary. */
export function executableRoles(roles: StudioRole[]): Omit<StudioRole, 'overrides'>[] {
  return roles.map(({ name, role, model, reasoning, spawn, persona }) => ({ name, role, model, reasoning, spawn, persona }));
}
