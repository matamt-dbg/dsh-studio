import { parsePreviewRequest } from './prompt-composition.ts';
import { StudioSurface } from './ui.tsx';
import { OptimizationPrototype } from './optimization-prototype.tsx';
import React from "react";
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots';
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { ServiceLayout, type StudioServiceItem } from './service-layout.tsx';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { StudioContext, IconProps } from "./contracts.js";
import { PACKAGE_NAME, STUDIO_VERSION } from './package-name.ts';
import { createUpdateStore, type UpdateActions } from './update-store.ts';
import { SidebarIcon, VersionFooter } from './update-indicator.tsx';
import { mountPixie, pixieDescriptors } from './pixie-client.tsx';
import { mountSettingsX } from './settingsx-client.tsx';
import { DshMarkdown } from './ui-host.tsx';
import { mountSessionRoles, sessionRoleDescriptors } from './session-roles-client.tsx';
import { registerDshKo } from './dsh-ko-locale.ts';
import { dshKo } from './dsh-ko/index.ts';

export const inject = ["slots", "locale", "remote"];
const panel = "local-dsh-studio";
export async function apply(ctx: StudioContext) {
    const remote = ctx.get('remote' as never) as unknown as { $mount(contribution: unknown): Promise<() => void> };
    await remote.$mount({ package: PACKAGE_NAME, descriptors: [{
        id: `${PACKAGE_NAME}#studioCatalog/read`, service: 'studioCatalog', namespace: 'studioCatalog', method: 'read',
        invocation: { kind: 'direct' }, parameters: [], result: { mode: 'src-json' },
    }, {
        id: `${PACKAGE_NAME}#studioCatalog/preview`, service: 'studioCatalog', namespace: 'studioCatalog', method: 'preview',
        invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'PreviewRequest', create: () => ({ parse: parsePreviewRequest }) } }], result: { mode: 'src-json' },

    }, ...['updateStatus', 'updateStudio'].map(method => ({
        id: `${PACKAGE_NAME}#studioCatalog/${method}`, service: 'studioCatalog', namespace: 'studioCatalog', method,
        invocation: { kind: 'direct' }, parameters: [{ name: method === 'updateStatus' ? 'force' : 'version', wire: method === 'updateStatus' ? 'force' : 'version', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => ({ parse: (value: unknown) => { if (typeof value !== 'string') throw new TypeError('Expected a string'); return value; } }) } }], result: { mode: 'src-json' },
    })), ...['listPresets', 'savePreset', 'applyPreset', 'unapplyPreset', 'roleModels', 'deletePreset', 'readExtensions', 'saveExtensions', 'catalogChange', 'confirmCatalogChange', 'addMasterPlugin', 'removeMasterPlugin'].map(method => ({
        id: `${PACKAGE_NAME}#studioCatalog/${method}`, service: 'studioCatalog', namespace: 'studioCatalog', method,
        invocation: { kind: 'direct' }, parameters: ['listPresets', 'readExtensions', 'roleModels', 'catalogChange', 'confirmCatalogChange'].includes(method) ? [] : [{ name: ['savePreset', 'saveExtensions', 'addMasterPlugin'].includes(method) ? 'payload' : 'id', wire: ['savePreset', 'saveExtensions', 'addMasterPlugin'].includes(method) ? 'payload' : 'id', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => ({ parse: (value: unknown) => { if (typeof value !== 'string') throw new TypeError('Expected a string'); return value; } }) } }], result: { mode: 'src-json' },
    })), ...pixieDescriptors(), ...sessionRoleDescriptors()] });
    mountSessionRoles(ctx);
    // `updates` is created below; the footer reads it only when the page renders.
    mountPixie(ctx, { navFooter: locale => <VersionFooter store={updates} locale={locale} />, markdown: DshMarkdown });
    mountSettingsX(ctx, { navFooter: locale => <VersionFooter store={updates} locale={locale} /> });
    ctx.effect(() => ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }));
    // A namespace where DSH already ships `ko` keeps DSH's dictionary; the others still register.
    ctx.effect(() => registerDshKo(ctx.locale, dshKo, ({ ns, error }) => ctx.logger?.warn?.(`studio: DSH ko dictionary for ${ns} skipped: ${String(error)}`)));
    const serviceListeners = new Set<() => void>();
    let services: readonly StudioServiceItem[] = [];
    const syncServices = () => {
        services = ctx.slots.entriesOfSlot('local.dsh-studio.services').slice().sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0)).map(({ options }) => ({
            id: options.id!, label: resolveSlotLabel(options.label) ?? options.id!,
        }));
        serviceListeners.forEach(listener => listener());
    };
    ctx.effect(() => ctx.slots.subscribe('local.dsh-studio.services', syncServices));
    ctx.effect(() => ctx.locale.subscribe(syncServices));
    const updateActions: UpdateActions = (() => {
        const call = async (method: string, arg: string) => {
            const service = ctx.get('remote.studioCatalog' as never) as unknown as Record<string, ((arg: string) => Promise<{ ok: boolean; value: unknown; error?: { message: string } }>) | undefined> | undefined;
            const fn = service?.[method];
            if (!fn) throw new Error('Studio update API unavailable');
            const result = await fn(arg);
            if (!result.ok) throw new Error(result.error?.message ?? 'Update request failed');
            return result.value;
        };
        return {
            status: force => call('updateStatus', force ? 'force' : '') as ReturnType<UpdateActions['status']>,
            update: version => call('updateStudio', version) as ReturnType<UpdateActions['update']>,
        };
    })();
    const updates = createUpdateStore(updateActions, STUDIO_VERSION);
    // The sidebar mark needs the answer before Studio opens; the Host caches registry answers.
    void updates.refresh();
    function StudioServices({ renderSlot }: PropsRenderSlots<'local.dsh-studio.services'>) {
        const items = React.useSyncExternalStore(listener => { serviceListeners.add(listener); return () => { serviceListeners.delete(listener); }; }, () => services);
        const locale = React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getLocale().active);
        return <StudioSurface className="studio-shell"><main className="studio-page">
            <ServiceLayout locale={locale} services={items} renderSlot={renderSlot} />
        </main></StudioSurface>;
    }
    function Icon({ size = 20 }: IconProps) {
        const locale = React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getLocale().active);
        return <SidebarIcon size={size} store={updates} locale={locale} />;
    }
    ctx.slots.inject("main", () =>
        ctx.slots.register(
            {
                name: "main",
                key: panel,
                children: {
                    'local.dsh-studio.services': { kind: 'list', scope: 'root' },
                },
            },
            StudioServices,
        ),
    );
    function OptimizationPage() {
        const locale = React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getLocale().active);
        const [catalog, setCatalog] = React.useState<import('./preset-catalog.ts').PresetCatalog>();
        const [catalogError, setCatalogError] = React.useState('');
        React.useEffect(() => {
            let active = true;
            const remote = ctx.get('remote.studioCatalog' as never) as unknown as { read(): Promise<{ ok: boolean; value: import('./preset-catalog.ts').PresetCatalog; error?: { message: string } }> } | undefined;
            if (!remote) { setCatalogError('Studio catalog API unavailable'); return; }
            remote.read().then(result => { if (!active) return; if (result.ok) setCatalog(result.value); else setCatalogError(result.error?.message ?? 'Catalog request failed'); }, error => { if (active) setCatalogError(String(error)); });
            return () => { active = false; };
        }, []);
        const presetActions = React.useMemo(() => {
            const call = async (method: string, ...args: unknown[]) => {
                const service = ctx.get('remote.studioCatalog' as never) as unknown as Record<string, (...args: unknown[]) => Promise<{ ok: boolean; value: unknown; error?: { message: string } }>>;
                const result = await service[method]!(...args);
                if (!result.ok) throw new Error(result.error?.message ?? 'Preset request failed');
                return result.value;
            };
            return {
                list: () => call('listPresets') as Promise<import('./preset-manager.tsx').SavedPreset[]>,
                save: (payload: string) => call('savePreset', payload) as Promise<import('./preset-manager.tsx').SavedPreset>,
                apply: (id: string) => call('applyPreset', id) as Promise<import('./preset-manager.tsx').SavedPreset>,
                models: () => call('roleModels') as Promise<import('./role-editor.tsx').RoleModelCatalog>,
                unapply: (id: string) => call('unapplyPreset', id),
                delete: (id: string) => call('deletePreset', id),
            };
        }, []);
        const extensionActions = React.useMemo(() => {
            const call = async (method: string, ...args: unknown[]) => {
                const service = ctx.get('remote.studioCatalog' as never) as unknown as Record<string, (...args: unknown[]) => Promise<{ ok: boolean; value: unknown; error?: { message: string } }>>;
                const result = await service[method]!(...args);
                if (!result.ok) throw new Error(result.error?.message ?? 'Master update failed');
                return result.value;
            };
            const update = async (method: string, arg: string) => { setCatalog(await call(method, arg) as import('./preset-catalog.ts').PresetCatalog); };
            return { read: () => call('readExtensions'), save: (payload: string) => update('saveExtensions', payload),
                add: (name: string) => update('addMasterPlugin', name), remove: (id: string) => update('removeMasterPlugin', id) };
        }, []);
        const catalogChanges = React.useMemo(() => {
            const call = async (method: string) => {
                const service = ctx.get('remote.studioCatalog' as never) as unknown as Record<string, () => Promise<{ ok: boolean; value: unknown; error?: { message: string } }>>;
                const result = await service[method]!();
                if (!result.ok) throw new Error(result.error?.message ?? 'Catalog change request failed');
                return result.value;
            };
            return { read: () => call('catalogChange') as Promise<import('./master-snapshot.ts').CatalogChange | { error: string } | null>, confirm: () => call('confirmCatalogChange') as Promise<{ cleaned: number }> };
        }, []);
        React.useEffect(() => { void updates.refresh(); }, []);
        return <OptimizationPrototype catalogChanges={catalogChanges} navFooter={<VersionFooter store={updates} locale={locale} />} extensionActions={extensionActions} presetActions={presetActions} locale={locale} catalog={catalog} catalogError={catalogError} onPreview={async request => {
            const service = ctx.get('remote.studioCatalog' as never) as unknown as { preview(request: import('./prompt-composition.ts').PreviewRequest): Promise<{ ok: boolean; value: import('./prompt-composition.ts').PreviewResult; error?: { message: string } }> };
            const response = await service.preview(request);
            if (!response.ok) throw new Error(response.error?.message ?? 'Preview failed');
            return response.value;
        }} />;
    }
    ctx.slots.inject('local.dsh-studio.services', () => ctx.slots.register({
        name: 'local.dsh-studio.services', id: 'optimization-prototype', order: 0,
        label: () => ({ ko: '프리셋', en: 'Presets', zh: '预设' }[ctx.locale.getLocale().active] ?? 'Presets'),
    }, OptimizationPage));
    syncServices();
    ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
            {
                name: "sidebar.panellist",
                id: panel,
                order: 20,
                label: "DSH Studio",
            },
            Icon,
        ),
    );
}
