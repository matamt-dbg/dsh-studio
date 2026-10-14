import { parsePreviewRequest } from './prompt-composition.ts';
import { StudioSurface } from './ui.tsx';
import { OptimizationPrototype } from './optimization-prototype.tsx';
import React from "react";
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots';
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { ServiceLayout, type StudioServiceItem } from './service-layout.tsx';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { StudioContext, IconProps } from "./contracts.js";
import { PACKAGE_NAME } from './package-name.ts';

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

    }, ...['listPresets', 'savePreset', 'applyPreset', 'unapplyPreset', 'roleModels', 'deletePreset', 'readExtensions', 'saveExtensions'].map(method => ({
        id: `${PACKAGE_NAME}#studioCatalog/${method}`, service: 'studioCatalog', namespace: 'studioCatalog', method,
        invocation: { kind: 'direct' }, parameters: ['listPresets', 'readExtensions', 'roleModels'].includes(method) ? [] : [{ name: ['savePreset', 'saveExtensions'].includes(method) ? 'payload' : 'id', wire: ['savePreset', 'saveExtensions'].includes(method) ? 'payload' : 'id', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => ({ parse: (value: unknown) => { if (typeof value !== 'string') throw new TypeError('Expected a string'); return value; } }) } }], result: { mode: 'src-json' },
    }))] });
    ctx.effect(() => ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }));
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
    function StudioServices({ renderSlot }: PropsRenderSlots<'local.dsh-studio.services'>) {
        const items = React.useSyncExternalStore(listener => { serviceListeners.add(listener); return () => { serviceListeners.delete(listener); }; }, () => services);
        const locale = React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getLocale().active);
        return <StudioSurface className="studio-shell"><main className="studio-page">
            <ServiceLayout locale={locale} services={items} renderSlot={renderSlot} />
        </main></StudioSurface>;
    }
    function Icon({ size = 20 }: IconProps) {
        return (
            <svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
            >
                <rect x="3" y="3" width="7" height="7" rx="2" />
                <rect x="14" y="3" width="7" height="7" rx="2" />
                <rect x="3" y="14" width="7" height="7" rx="2" />
                <path d="M17.5 14v7M14 17.5h7" />
            </svg>
        );
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
            return { read: () => call('readExtensions'), save: async (payload: string) => { setCatalog(await call('saveExtensions', payload) as import('./preset-catalog.ts').PresetCatalog); } };
        }, []);
        return <OptimizationPrototype extensionActions={extensionActions} presetActions={presetActions} locale={locale} catalog={catalog} catalogError={catalogError} onPreview={async request => {
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
