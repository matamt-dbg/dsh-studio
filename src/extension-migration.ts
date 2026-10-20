/**
 * Moving profile-scoped rows out of the Studio Master (#38 D7). The plan only reads: which added rows
 * must leave, their configs and per-preset overrides (secrets masked), and the applied snapshots
 * that still carry them. Removing the row from the Master is always allowed and keeps a backup;
 * presets whose applied snapshot still mounts the entry must be reapplied (or unapplied) before the
 * entry is registered in the profile, or restoring that snapshot would register it a second time.
 */
import type { CompositionRow } from './prompt-composition.ts';
import type { InstalledPlugin } from './installed-plugins.ts';
import { maskConfig } from './secret-fields.ts';

export const ADDED_PREFIX = 'studio-added/';

export interface MigrationPreset { id: string; name: string; overrides: Record<string, Record<string, unknown>>; appliedNames?: readonly string[] }
export interface MigrationItem {
  /** Extension row id (without the `studio-added/` prefix). */
  id: string;
  entry: string;
  /** Row config, secrets masked. */
  config: Record<string, unknown>;
  /** Per-preset Config overrides of this row, secrets masked. Different values are listed, never merged. */
  overrides: Array<{ preset: string; name: string; config: Record<string, unknown> }>;
  /** Applied presets whose snapshot still mounts this entry: reapply or unapply them before registering it in the profile. */
  appliedIn: Array<{ preset: string; name: string }>;
}

export function migrationPlan(input: {
  extensions: readonly CompositionRow[];
  installed: readonly InstalledPlugin[];
  presets: readonly MigrationPreset[];
  roles?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}): MigrationItem[] {
  const profile = new Set(input.installed.filter(plugin => plugin.scope === 'profile').map(plugin => plugin.entry));
  return input.extensions.filter(row => !row.group && profile.has(row.name)).map(row => {
    const roles = input.roles?.[row.name] ?? {};
    const configId = `${ADDED_PREFIX}${row.id}`;
    return {
      id: String(row.id), entry: row.name, config: maskConfig(row.config, roles),
      overrides: input.presets.filter(preset => preset.overrides[configId]).map(preset => ({ preset: preset.id, name: preset.name, config: maskConfig(preset.overrides[configId], roles) })),
      appliedIn: input.presets.filter(preset => preset.appliedNames?.includes(row.name)).map(preset => ({ preset: preset.id, name: preset.name })),
    };
  });
}

/** Backup record written before a row leaves the Master: raw values, owner-only file. */
export interface MigrationBackup {
  movedAt: string;
  row: CompositionRow;
  overrides: Array<{ preset: string; config: Record<string, unknown> }>;
}
