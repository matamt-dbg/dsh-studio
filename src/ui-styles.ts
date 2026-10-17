/** Scoped Studio stylesheet embedded in distributable Client JavaScript. */
/** Host token adapter: the only place Studio references `--dsw-*` tokens. */
const adapter = `.studio-ui {
  --studio-bg: var(--dsw-alias-bg-base);
  --studio-surface: var(--dsw-alias-bg-layer-1);
  --studio-inset: var(--dsw-alias-bg-layer-2);
  --studio-ink: var(--dsw-alias-label-primary);
  --studio-muted: var(--dsw-alias-label-secondary);
  --studio-subtle: var(--dsw-alias-label-tertiary);
  --studio-line: var(--dsw-alias-border-l2);
  --studio-control-line: var(--dsw-alias-border-l3);
  --studio-accent: var(--dsw-alias-brand-primary);
  --studio-hover: var(--dsw-alias-interactive-bg-hover);
  --studio-pressed: var(--dsw-alias-interactive-bg-active);
  --studio-primary-fill: var(--dsw-alias-button-primary-fill);
  --studio-primary-hover: var(--dsw-alias-button-primary-hover);
  --studio-on-primary: var(--dsw-alias-label-primary-foreground);
  --studio-focus: var(--dsw-focus-ring-color);
  --studio-error: var(--dsw-alias-state-error-primary);
  --studio-success: var(--dsw-alias-state-success-primary);
  --studio-warn: var(--dsw-alias-state-warn-primary);
  --studio-info: var(--dsw-alias-state-business-primary);
  --studio-neutral-fill: var(--dsw-alias-bg-module-platform);
  --studio-radius: 12px;
  --studio-control-radius: var(--dsw-radius-md);
  --studio-small-radius: var(--dsw-radius-sm);
  --studio-gap: 16px;
  color: var(--studio-ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
}
`;
export const studioStyles = `/* Only this adapter references host tokens. Studio never installs a global theme. */
${adapter}.studio-ui *, .studio-ui *::before, .studio-ui *::after { box-sizing: border-box; }
.studio-ui .studio-tool-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.studio-ui .studio-tool-card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--studio-line); border-radius: var(--studio-radius); cursor: pointer; min-width: 0; }
.studio-ui .studio-tool-card[data-selected="true"] { background: var(--studio-hover); border-color: var(--studio-ink); }
.studio-ui .studio-card-excerpt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-weight: 400; color: var(--studio-muted); }
.studio-ui .studio-tool-card strong { overflow-wrap: anywhere; }
.studio-ui .studio-detail-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow: auto; padding: 0; color: var(--studio-ink); background: var(--studio-bg); border: 1px solid var(--studio-line); border-radius: var(--studio-radius); }
.studio-ui .studio-detail-dialog::backdrop { background: var(--studio-muted); opacity: 0.45; }
.studio-ui .studio-selection-detail { padding: 16px; margin-top: 12px; border: 1px solid var(--studio-line); border-radius: var(--studio-radius); }
.studio-ui .studio-schema-tool { margin-top: 12px; padding: 10px; border: 1px solid var(--studio-line); border-radius: var(--studio-small-radius); }
.studio-ui .studio-schema-tool summary { cursor: pointer; overflow-wrap: anywhere; }
.studio-ui .studio-schema-meta { color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-row button[aria-pressed="true"] { background: var(--studio-hover); border-color: var(--studio-ink); }
.studio-ui .studio-tool-description { white-space: pre-wrap; overflow-wrap: anywhere; }
.studio-ui .studio-tool-card strong { font-weight: 500; }
.studio-ui .studio-comparison { margin-top: 24px; }
.studio-ui .studio-comparison-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: var(--studio-gap); align-items: start; }
.studio-ui .studio-comparison-grid > section { min-width: 0; }
.studio-ui .studio-comparison h4 { font-size: 14px; font-weight: 500; margin: 8px 0; }
.studio-ui .studio-comparison-panel { border: 1px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); padding: 6px; overflow: hidden; }
.studio-ui .studio-comparison-native-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto 12px; gap: 12px; padding: 12px; align-items: center; border-radius: var(--studio-radius); }
.studio-ui .studio-comparison-native-row:first-child { background: var(--studio-hover); }
.studio-ui .studio-comparison-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--studio-success); align-self: start; margin-top: 8px; }
.studio-ui .studio-comparison-label > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.studio-ui .studio-comparison-secondary, .studio-ui .studio-comparison-metrics, .studio-ui .studio-comparison-chevron { color: var(--studio-muted); }
.studio-ui .studio-comparison-metrics { text-align: right; font-size: 12px; white-space: nowrap; }
.studio-ui .studio-comparison-chevron { font-size: 20px; }
.studio-ui .studio-comparison-panel .studio-catalog-row { padding: 10px; }
.studio-ui .studio-comparison-panel .studio-catalog-row:first-child { border-top: 0; }
.studio-ui .studio-comparison-snapshot { background: var(--studio-inset); border-radius: var(--studio-small-radius); padding: 8px; margin-top: 8px; }
.studio-ui .studio-comparison-navigation { color: var(--studio-muted); }
.studio-ui.studio-catalog { width: min(336px, calc(100vw - 32px)); max-height: 65vh; overflow: auto; padding: 8px; }
.studio-ui .studio-catalog-row { padding: 8px 0; border-top: 1px solid var(--studio-line); }
.studio-ui .studio-catalog-row p { margin: 4px 0; }
.studio-ui .studio-catalog-meta { color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-catalog-branch .studio-catalog-branch { margin-left: 12px; padding-left: 8px; border-left: 1px solid var(--studio-line); }
.studio-ui .studio-catalog-task, .studio-ui .studio-catalog-row pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.studio-ui .studio-catalog-expand { color: var(--studio-ink); background: transparent; border: 0; border-radius: var(--studio-small-radius); padding: 4px 8px; font: inherit; cursor: pointer; }
.studio-ui .studio-catalog-expand:hover { background: var(--studio-hover); }
.studio-ui .studio-catalog-expand:focus-visible { outline: 2px solid var(--studio-focus); }
.studio-ui.studio-catalog-launch fieldset { border: 0; padding: 0; margin: 0 0 12px; }
.studio-ui.studio-catalog-launch textarea { min-height: 100px; }

.studio-ui h1, .studio-ui h2, .studio-ui h3, .studio-ui h4, .studio-ui strong, .studio-ui legend { font-weight: 500; }
.studio-ui h1 { font-size: 28px; line-height: 1.3; margin: 8px 0 12px; }
.studio-ui h2 { font-size: 18px; line-height: 1.4; margin: 0 0 12px; }
.studio-ui h3 { font-size: 14px; line-height: 1.5; margin: 16px 0 8px; }
.studio-ui h4 { font-size: 13px; line-height: 1.5; margin: 0; }
.studio-ui p { margin: 8px 0 16px; }
.studio-ui .studio-muted, .studio-ui dt { color: var(--studio-muted); }
.studio-ui .studio-hint { font-size: 12px; margin: 0; }
.studio-ui .studio-grow { flex: 1 1 auto; min-width: 0; }
.studio-ui .studio-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }

/* Page frame: navigation and content scroll independently, so selecting a section never moves the navigation. */
.studio-ui.studio-shell { height: 100%; overflow: hidden; container: studio-shell / inline-size; }
.studio-ui .studio-page { height: 100%; background: var(--studio-bg); }
.studio-ui .studio-services { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.studio-ui .studio-service-nav { display: flex; flex: 0 0 auto; gap: 8px; padding: 12px 16px; overflow-x: auto; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-service-nav .studio-nav-item { white-space: nowrap; flex-shrink: 0; }
.studio-ui .studio-service-panel { flex: 1; min-height: 0; overflow-y: auto; }
.studio-ui .studio-service-panel[hidden] { display: none; }
.studio-ui .studio-service-panel > .studio-ui { max-width: 960px; margin: 0 auto; padding: 24px clamp(16px, 3vw, 40px) 48px; }
.studio-ui .studio-layout { display: grid; grid-template-columns: 208px minmax(0, 1fr); height: 100%; }
/* Version footer pinned to the bottom of the Studio navigation. */
.studio-ui .studio-nav-footer { display: flex; align-items: center; gap: 6px; margin-top: auto; padding: 12px 10px 0; color: var(--studio-subtle); font-size: 12px; }
.studio-ui .studio-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--studio-small-radius); background: none; color: var(--studio-info); cursor: pointer; }
.studio-ui .studio-icon-button:hover:not(:disabled) { background: var(--studio-hover); }
.studio-ui .studio-icon-button[data-tone=success] { color: var(--studio-success); }
.studio-ui .studio-icon-button[data-tone=error] { color: var(--studio-error); }
.studio-ui .studio-icon-button:disabled { cursor: default; opacity: 1; }
.studio-ui .studio-icon-button[aria-busy=true] { opacity: .5; }
.studio-ui nav.studio-nav { display: flex; flex-direction: column; flex-wrap: nowrap; gap: 2px; margin: 0; padding: 24px 12px; border-inline-end: .5px solid var(--studio-line); overflow-y: auto; }
.studio-ui .studio-nav-group, .studio-ui .studio-list-group { display: flex; align-items: center; gap: 6px; padding: 16px 10px 4px; color: var(--studio-subtle); font-size: 12px; }
.studio-ui .studio-nav-badge { padding: 0 6px; border: .5px solid var(--studio-control-line); border-radius: 999px; font-size: 11px; line-height: 16px; }
.studio-ui :is(.studio-nav-item, .studio-list-item) { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 5px 10px; border: 0; border-radius: var(--studio-control-radius); background: none; color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui :is(.studio-nav-item, .studio-list-item):hover { background: var(--studio-hover); }
.studio-ui :is(.studio-nav-item, .studio-list-item)[aria-current] { background: var(--studio-hover); font-weight: 500; }
.studio-ui .studio-scroller { min-width: 0; overflow-y: auto; scrollbar-gutter: stable; container: studio-main / inline-size; }
.studio-ui .studio-content { max-width: 960px; margin: 0 auto; padding: 24px clamp(16px, 3vw, 40px) 48px; }
.studio-ui .studio-feature-stack { display: grid; gap: 24px; }
.studio-ui .studio-page-stack { display: grid; gap: var(--studio-gap); min-width: 0; }
.studio-ui .studio-page-stack > p, .studio-ui .studio-detail > p { margin: 0; }
.studio-ui .studio-page-head h2 { margin: 0 0 4px; }
.studio-ui .studio-page-head p { margin: 0; }
.studio-ui .studio-page-head + * { margin-top: 0; }
.studio-ui section > .studio-page-head { margin-bottom: var(--studio-gap); }
.studio-ui .studio-page-head-actions { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--studio-gap); }
.studio-ui .studio-status-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0 0; }
.studio-ui .studio-note { margin: 0; padding: 6px 12px; border-radius: var(--studio-control-radius); background: var(--studio-hover); color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.studio-ui .studio-section-head :is(h3, h4, p) { margin: 0; }
.studio-ui .studio-section-head p { margin-top: 2px; }
.studio-ui .studio-section-head-field { align-items: flex-end; }
.studio-ui .studio-section-head-field > label { margin: 0; }
.studio-ui .studio-panel-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; }
.studio-ui h3.studio-section-title { margin: 0; font-size: 18px; }
.studio-ui .studio-block-section { display: grid; gap: 8px; }
.studio-ui .studio-block-section > :is(h3, p) { margin: 0; }

/* Buttons follow the DSH outline and primary variants. */
.studio-ui .studio-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 32px; padding: 0 12px; margin: 2px 4px 2px 0; border: .5px solid var(--studio-control-line); border-radius: var(--studio-control-radius); background: transparent; color: var(--studio-ink); font: inherit; font-weight: 500; line-height: 20px; white-space: nowrap; cursor: pointer; }
.studio-ui .studio-button:hover:not(:disabled) { background: var(--studio-hover); }
.studio-ui .studio-button:active:not(:disabled) { background: var(--studio-pressed); }
.studio-ui .studio-button.studio-primary { border-color: transparent; background: var(--studio-primary-fill); color: var(--studio-on-primary); }
.studio-ui .studio-button.studio-primary:hover:not(:disabled) { background: var(--studio-primary-hover); }
.studio-ui .studio-button.studio-small { height: 28px; padding: 0 10px; font-size: 12px; line-height: 18px; border-radius: var(--studio-small-radius); }
.studio-ui [role=switch][aria-checked=true] { border-color: var(--studio-ink); }
.studio-ui .studio-inline-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.studio-ui .studio-inline-actions .studio-button, .studio-ui.studio-modal-footer .studio-button { margin: 0; }
.studio-ui.studio-modal-footer { display: flex; justify-content: flex-end; gap: 8px; }
.studio-ui :is(button, input, textarea, select):focus-visible { outline: 2px solid var(--studio-focus, var(--studio-accent)); outline-offset: 2px; }
.studio-ui :is(button, input, textarea, select):disabled { cursor: not-allowed; opacity: .4; }

/* Tabs follow the Plugins page: tertiary labels with a primary underline. */
.studio-ui .studio-tabs { position: sticky; top: 0; z-index: 2; display: flex; align-items: flex-end; gap: 22px; margin: 0; padding-top: 8px; border-bottom: .5px solid var(--studio-line); background: var(--studio-bg); overflow-x: auto; scrollbar-width: none; }
.studio-ui .studio-tab { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 7px 1px 9px; border: 0; background: transparent; color: var(--studio-subtle); font: inherit; line-height: 20px; white-space: nowrap; cursor: pointer; }
.studio-ui .studio-tab:hover, .studio-ui .studio-tab[aria-selected=true] { color: var(--studio-ink); }
.studio-ui .studio-tab[aria-selected=true]::after { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; border-radius: 2px 2px 0 0; background: var(--studio-ink); content: ''; }
.studio-ui .studio-view-switch { max-width: 320px; }
.studio-ui .studio-tab-panel { min-height: calc(100vh - 48px); }

/* Forms. Field rules skip checkbox labels and inputs so host primitives such as Checkbox keep their own layout. */
.studio-ui fieldset { min-width: 0; margin: 16px 0; padding: 16px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); }
.studio-ui legend { padding: 0 8px; font-size: 14px; line-height: 1.5; }
.studio-ui .studio-role-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--studio-gap); }
.studio-ui label:not(:has(> input[type=checkbox])) { display: grid; gap: 6px; margin: 12px 0; }
.studio-ui label:not([class]):has(> input[type=checkbox]) { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
/* A preset field label wraps its control inline; the fieldset ancestor outranks the grid label rule above. */
.studio-ui fieldset label.studio-inline-label { display: block; }
.studio-ui input:not([type=checkbox]), .studio-ui textarea, .studio-ui select { width: 100%; min-width: 0; padding: 6px 10px; border: .5px solid var(--studio-control-line); border-radius: var(--studio-control-radius); background: var(--studio-bg); color: var(--studio-ink); font: inherit; }
.studio-ui input:not([type=checkbox]), .studio-ui select { min-height: 32px; }
/* Native select arrows hug the edge; draw an inset chevron in the text color instead. */
.studio-ui select:not([multiple]) { appearance: none; -webkit-appearance: none; padding-inline-end: 34px; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: right 17px top 50%, right 12px top 50%; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; text-overflow: ellipsis; }
.studio-ui textarea { min-height: 144px; resize: vertical; }
.studio-ui .studio-field { display: grid; gap: 6px; margin: 12px 0; }
.studio-ui .studio-edit-row { align-items: flex-end; }
.studio-ui .studio-edit-row > .studio-field { flex: 1 1 180px; min-width: 0; margin: 0; }
.studio-ui .studio-edit-row > .studio-notice-row { flex-basis: 100%; }
.studio-ui .studio-field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 0 var(--studio-gap); }

/* Prompt assembly map and native multi-select transfer lists. */
.studio-ui .studio-prompt-workbench { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 20px; align-items: start; text-align: start; }
.studio-ui ol.studio-steps { margin: 0; padding-inline-start: 20px; }
.studio-ui .studio-page-stack > pre { margin: 0; }
.studio-ui .studio-page-stack > :is(.studio-field, label) { margin: 0; }
.studio-ui ol.studio-steps li { margin-bottom: 4px; }
.studio-ui ol.studio-prompt-stages { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-prompt-document { max-height: 680px; overflow-y: auto; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui .studio-prompt-section { display: grid; grid-template-columns: minmax(130px, 1fr) minmax(0, 3fr); gap: 18px; padding: 18px; border-bottom: .5px solid var(--studio-line); border-inline-start: 3px solid transparent; scroll-margin: 8px; }
.studio-ui .studio-prompt-section h3 { overflow-wrap: anywhere; }
.studio-ui .studio-prompt-section > p { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.studio-ui .studio-prompt-tools { padding: 18px; }
@media (max-width: 600px) { .studio-ui .studio-prompt-section { grid-template-columns: 1fr; gap: 8px; } }
.studio-ui .studio-prompt-section[data-selected=true] { border-inline-start-color: var(--studio-ink); background: var(--studio-hover); }
.studio-ui .studio-prompt-section h3 { margin: 0; font-size: 14px; font-weight: 500; }
.studio-ui .studio-prompt-section textarea, .studio-ui .studio-prompt-section .studio-history-content { margin-top: 12px; }
@media (max-width: 800px) {
  .studio-ui .studio-prompt-workbench { grid-template-columns: minmax(0, 1fr); }
  .studio-ui ol.studio-steps { margin: 0; padding-inline-start: 20px; }
.studio-ui .studio-page-stack > pre { margin: 0; }
.studio-ui .studio-page-stack > :is(.studio-field, label) { margin: 0; }
.studio-ui ol.studio-steps li { margin-bottom: 4px; }
.studio-ui ol.studio-prompt-stages { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.studio-ui .studio-prompt-stages .studio-pick { width: 100%; height: 100%; display: grid; gap: 6px; text-align: start; }
.studio-ui .studio-prompt-stages [aria-current=step] { border-color: var(--studio-ink); background: var(--studio-hover); }
.studio-ui .studio-tool-transfer { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 16px; }
.studio-ui .studio-transfer-column { min-width: 0; border: 1px solid var(--studio-line); border-radius: var(--studio-radius); }
.studio-ui .studio-transfer-items { display: grid; gap: 10px; max-height: 460px; overflow-y: auto; padding: 8px; }
.studio-ui .studio-transfer-actions { display: flex; flex-direction: column; justify-content: center; gap: 10px; }
.studio-ui .studio-prompt-stages { display: grid; gap: 6px; }
.studio-ui .studio-tool-transfer select { min-height: 260px; }
.studio-ui .studio-tool-transfer option { padding: 6px; }
.studio-ui .studio-transfer-actions { display: flex; flex-direction: column; justify-content: center; gap: 8px; }
@media (max-width: 640px) {
  .studio-ui .studio-tool-transfer { grid-template-columns: minmax(0, 1fr); }
  .studio-ui .studio-transfer-actions { flex-direction: row; }
}

/* Existing Studio surfaces. */
.studio-ui .studio-card, .studio-ui article { padding: 20px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); min-width: 0; }
.studio-ui article + article { margin-top: var(--studio-gap); }
.studio-ui .studio-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--studio-gap); }
.studio-ui .studio-actions, .studio-ui nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: var(--studio-gap); }
.studio-ui dl { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 3fr); gap: 8px 16px; margin: 16px 0; }
.studio-ui dd { margin: 0; min-width: 0; }
.studio-ui [role=alert] { margin: 0; padding: 8px 12px; border-inline-start: 2px solid var(--studio-error); color: var(--studio-error); }
.studio-ui [role=status] { color: var(--studio-muted); }
.studio-ui pre { max-width: 100%; overflow: auto; padding: 12px; border-radius: 8px; background: var(--studio-inset); font-size: 12px; line-height: 1.6; }
.studio-ui .studio-history-content { white-space: pre-wrap; overflow-wrap: anywhere; }
.studio-ui ol, .studio-ui ul { padding-inline-start: 20px; }
.studio-ui li { margin-bottom: 8px; }
.studio-ui .studio-agents { padding: 20px; }
.studio-ui .studio-timer { padding: 20px; border-radius: var(--studio-radius); background: var(--studio-inset); }
.studio-ui .studio-timer strong { font-size: 28px; line-height: 1.4; font-variant-numeric: tabular-nums; }
.studio-ui .studio-timer span { font-size: 13px; line-height: 1.6; }

/* Design mock: cards, lists, and tables. */
.studio-ui .studio-inline-state { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.studio-ui .studio-notice-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.studio-ui .studio-notice-info { margin: 0; padding: 8px 12px; border-inline-start: 2px solid var(--studio-info); color: var(--studio-ink); background: var(--studio-hover); }
.studio-ui .studio-cards { display: grid; gap: 8px; }
.studio-ui .studio-component { min-width: 0; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui .studio-component-flat { padding: 4px 16px 16px; }
.studio-ui .studio-component-head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 12px 16px; border: 0; border-radius: var(--studio-radius); background: none; color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-component-head[aria-expanded=true] { border-radius: var(--studio-radius) var(--studio-radius) 0 0; }
.studio-ui .studio-component-head:hover { background: var(--studio-hover); }
.studio-ui .studio-component-title { flex: 0 0 auto; font-size: 14px; font-weight: 500; }
.studio-ui .studio-component-summary { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--studio-muted); text-overflow: ellipsis; white-space: nowrap; }
.studio-ui .studio-chevron { flex: 0 0 auto; color: var(--studio-muted); }
.studio-ui .studio-chevron[data-open=true] { transform: rotate(180deg); }
.studio-ui .studio-component-body { padding: 4px 16px 16px; border-top: .5px solid var(--studio-line); }
.studio-ui .studio-reason { margin: 12px 0; padding: 8px 12px; border-radius: var(--studio-control-radius); background: var(--studio-hover); color: var(--studio-muted); }
.studio-ui .studio-reason-warning { border-inline-start: 2px solid var(--studio-subtle); color: var(--studio-ink); }
.studio-ui .studio-effect { margin-top: 16px; padding-top: 12px; border-top: .5px solid var(--studio-line); }
.studio-ui .studio-effect span { color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-effect p { margin: 4px 0 0; }
.studio-ui .studio-card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.studio-ui .studio-card-actions .studio-button { margin: 0; }
.studio-ui .studio-card-actions:empty { display: none; }
.studio-ui .studio-blocks { margin: 0 0 8px; padding: 0; list-style: none; }
.studio-ui .studio-block { margin: 0; padding: 12px 0; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-block-head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
.studio-ui .studio-block-name { flex: 1 1 200px; margin: 0; }
.studio-ui .studio-block textarea { min-height: 72px; }
.studio-ui .studio-tool-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: 8px var(--studio-gap); }
.studio-ui .studio-tool-groups fieldset { display: grid; align-content: start; gap: 8px; margin: 8px 0 0; padding: 8px 12px 12px; }
.studio-ui .studio-tool-groups legend { color: var(--studio-muted); font-size: 13px; }
.studio-ui .studio-targets { display: grid; gap: 8px; margin: 12px 0; }
.studio-ui .studio-target { padding: 8px 12px; border: .5px solid var(--studio-line); border-radius: var(--studio-control-radius); }
.studio-ui .studio-target-body { padding-inline-start: 26px; }
.studio-ui .studio-target .studio-field { margin: 8px 0; }
.studio-ui .studio-tile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 8px; }
.studio-ui .studio-tile { display: grid; gap: 2px; padding: 12px 14px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-tile:hover { background: var(--studio-hover); }
.studio-ui .studio-tile-title { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.studio-ui .studio-plain-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-plain-list > li { margin: 0; }
.studio-ui .studio-list-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-system-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-system-grid > li { margin: 0; }
.studio-ui .studio-system { display: grid; gap: 4px; padding: 16px; }
.studio-ui .studio-system > p { margin: 0; }
.studio-ui .studio-facts { grid-template-columns: minmax(96px, 140px) minmax(0, 1fr); gap: 6px 12px; margin: 8px 0 0; }
.studio-ui .studio-master-detail { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; align-items: start; }
.studio-ui nav.studio-list { position: sticky; top: 0; display: flex; flex-direction: column; flex-wrap: nowrap; gap: 2px; margin: 0; }
.studio-ui .studio-list-group:first-child { padding-top: 0; }
.studio-ui .studio-list-text { display: grid; min-width: 0; }
.studio-ui .studio-list-text .studio-muted { font-size: 12px; font-weight: 400; }
.studio-ui .studio-detail { display: grid; gap: 12px; min-width: 0; }
.studio-ui .studio-detail > label { margin: 0; }
.studio-ui .studio-matrix-scroll { overflow-x: auto; }
.studio-ui .studio-matrix { width: 100%; border-collapse: collapse; }
.studio-ui .studio-matrix :is(th, td) { padding: 6px; border-bottom: .5px solid var(--studio-line); font-weight: 500; text-align: start; vertical-align: middle; }
.studio-ui .studio-matrix thead th { color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-matrix-cell { display: grid; align-content: center; width: 100%; min-height: 44px; padding: 6px 10px; border: 0; border-radius: var(--studio-control-radius); background: none; color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-matrix-cell:hover { background: var(--studio-hover); }
.studio-ui .studio-matrix-cell .studio-muted { font-size: 12px; }
.studio-ui .studio-checklist { margin: 0 0 12px; padding: 0; list-style: none; }
.studio-ui .studio-checklist li { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.studio-ui .studio-simulate { margin: 16px 0 0; padding-top: 12px; border-top: .5px dashed var(--studio-line); }
.studio-ui .studio-pick-list { display: grid; gap: 6px; margin: 0 0 12px; padding: 0; list-style: none; }
.studio-ui .studio-pick-list > li { margin: 0; }
.studio-ui .studio-pick { display: grid; gap: 2px; width: 100%; padding: 10px 12px; border: .5px solid var(--studio-control-line); border-radius: var(--studio-control-radius); background: transparent; color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-pick:hover { background: var(--studio-hover); }
.studio-ui .studio-pick[aria-checked=true] { border-color: var(--studio-ink); background: var(--studio-hover); }
.studio-ui .studio-pick-title { display: flex; align-items: center; gap: 6px; }

/* Shared form rhythm: stacks own their spacing so paragraphs and fields do not add stray margins. */
.studio-ui .studio-stack { display: grid; gap: 12px; min-width: 0; }
.studio-ui .studio-stack > :is(p, label, .studio-field, .studio-note, fieldset) { margin: 0; }
.studio-ui .studio-form-section { display: grid; gap: 12px; min-width: 0; }
.studio-ui .studio-form-section > :is(p, label, .studio-field, .studio-note) { margin: 0; }
.studio-ui .studio-field .studio-field-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; min-height: 28px; }
.studio-ui .studio-field .studio-field-head > label { display: block; margin: 0; }
.studio-ui .studio-field .studio-field-head .studio-button { margin: 0; }
.studio-ui .studio-field > .studio-hint { margin-top: -2px; }
.studio-ui .studio-count { margin-inline-start: 6px; color: var(--studio-subtle); font-size: 12px; font-weight: 400; }
.studio-ui .studio-button[aria-pressed="true"] { background: var(--studio-hover); border-color: var(--studio-ink); }

/* Status badges mirror the DSH Tag capsule: tinted fill, matching text, fixed geometry. */
.studio-ui .studio-badge { display: inline-flex; align-items: center; flex: 0 0 auto; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; line-height: 17px; white-space: nowrap; background: var(--studio-neutral-fill); color: var(--studio-muted); }
.studio-ui .studio-badge[data-tone=success] { background: color-mix(in srgb, var(--studio-success) 10%, transparent); color: var(--studio-success); }
.studio-ui .studio-badge[data-tone=warning] { background: color-mix(in srgb, var(--studio-warn) 12%, transparent); color: var(--studio-warn); }
.studio-ui .studio-badge[data-tone=info] { background: color-mix(in srgb, var(--studio-info) 10%, transparent); color: var(--studio-info); }
.studio-ui .studio-badge[data-tone=outline] { background: transparent; border: .5px solid var(--studio-control-line); color: var(--studio-subtle); }

/* Editor tabs and panels. */
.studio-ui .studio-editor-tabs { margin-top: 4px; }
.studio-ui .studio-tab-body { display: grid; align-content: start; gap: 24px; padding-top: 20px; min-width: 0; min-height: 70vh; }
.studio-ui .studio-tab-body[hidden] { display: none; }
.studio-ui .studio-tab-body > :is(p, .studio-note) { margin: 0; }
.studio-ui .studio-tab-body .studio-page-head h2 { font-size: 15px; }

/* Preset and role cards. */
.studio-ui .studio-tool-cards > article + article, .studio-ui .studio-transfer-items > article + article { margin-top: 0; }
.studio-ui article.studio-preset-card, .studio-ui article.studio-role-card { display: flex; flex-direction: column; gap: 6px; padding: 16px; }
.studio-ui .studio-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; }
.studio-ui .studio-card-head :is(h3, strong) { margin: 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.studio-ui .studio-card-head > :first-child { margin-inline-end: auto; }
.studio-ui .studio-card-text { margin: 0; color: var(--studio-muted); }
.studio-ui .studio-card-meta { margin: 0; color: var(--studio-subtle); font-size: 12px; }
.studio-ui .studio-card-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: auto; padding-top: 10px; }
.studio-ui .studio-card-footer .studio-button { margin: 0; }
.studio-ui .studio-card-note { margin-top: auto; padding-top: 10px; }
.studio-ui .studio-card-footer .studio-card-footer-end { margin-inline-start: auto; }
.studio-ui .studio-tool-cards.studio-card-pair { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.studio-ui pre.studio-turn-text { margin: 8px 0; padding: 10px 12px; max-height: 240px; overflow: auto; white-space: pre-wrap; border-radius: var(--studio-control-radius); background: var(--studio-hover); border: .5px solid var(--studio-line); color: var(--studio-ink); font-size: 12px; }
.studio-ui ul.studio-change-list { display: grid; gap: 4px; margin: 8px 0; padding: 0; list-style: none; overflow-wrap: anywhere; }
.studio-ui .studio-preset-warnings { display: flex; flex-direction: column; gap: 6px; margin: 0 0 12px; padding: 0; list-style: none; }
.studio-ui .studio-preset-warnings > li { display: flex; align-items: baseline; gap: 8px; padding: 6px 12px; border-radius: var(--studio-control-radius); background: var(--studio-hover); color: var(--studio-muted); font-size: 12px; }

/* Selection columns: a quiet header row and compact cards. */
.studio-ui .studio-transfer-column { display: flex; flex-direction: column; background: var(--studio-surface); }
.studio-ui .studio-transfer-column > .studio-section-head { padding: 10px 14px; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-transfer-column > .studio-section-head .studio-panel-title { font-size: 13px; }
.studio-ui .studio-transfer-items { padding: 10px; gap: 8px; }
.studio-ui .studio-transfer-items > p { margin: 4px; }
.studio-ui .studio-transfer-items > .studio-card { display: grid; gap: 6px; padding: 12px 14px; background: var(--studio-bg); }
.studio-ui .studio-transfer-items > .studio-card > p { margin: 0; }
.studio-ui .studio-transfer-items > .studio-card .studio-panel-title { font-size: 13px; overflow-wrap: anywhere; }
.studio-ui .studio-transfer-items > .studio-card .studio-section-head p { font-size: 12px; }
.studio-ui .studio-selection-detail { display: grid; gap: 12px; margin-top: 4px; }
.studio-ui .studio-selection-detail > :is(p, label, .studio-field, .studio-note, section) { margin: 0; }
.studio-ui .studio-selection-detail .studio-section-head { margin-top: 8px; }

/* Config form: root object has no frame; nested objects use a quiet rule; each field reads label → state → input. */
.studio-ui fieldset.studio-config-root { margin: 4px 0 0; padding: 0; border: 0; }
.studio-ui fieldset.studio-config-root fieldset { margin: 8px 0; padding: 4px 0 4px 12px; border: 0; border-inline-start: .5px solid var(--studio-control-line); border-radius: 0; }
.studio-ui fieldset.studio-config-root legend { padding: 0; color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-config-field { margin: 10px 0; }
.studio-ui .studio-config-list { display: grid; }
.studio-ui .studio-config-list .studio-list-row { padding: 4px 0; }
.studio-ui .studio-config-list .studio-list-row:last-child { border-bottom: 0; }
.studio-ui .studio-config-list .studio-list-row input { flex: 1; min-width: 0; }
.studio-ui .studio-config-list .studio-list-row .studio-config-item { flex: 1; min-width: 0; margin: 0; padding: 0 0 0 2px; border: 0; }
.studio-ui .studio-config-key { flex: 0 0 auto; min-width: 0; overflow-wrap: anywhere; color: var(--studio-muted); }
.studio-ui .studio-config-state { color: var(--studio-subtle); font-size: 12px; margin-inline-start: auto; }
.studio-ui .studio-config-field[data-overridden=true] .studio-config-state { color: var(--studio-info); }

/* Collapsible advanced block, styled like a component card. */
.studio-ui details.studio-disclosure { border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui details.studio-disclosure > summary { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-radius: var(--studio-radius); cursor: pointer; list-style: none; font-weight: 500; }
.studio-ui details.studio-disclosure > summary::-webkit-details-marker { display: none; }
.studio-ui details.studio-disclosure > summary::after { content: ''; width: 6px; height: 6px; margin-inline-start: auto; border-right: 1.3px solid var(--studio-muted); border-bottom: 1.3px solid var(--studio-muted); transform: rotate(45deg); }
.studio-ui details.studio-disclosure[open] > summary::after { transform: rotate(-135deg); }
.studio-ui details.studio-disclosure > summary:hover { background: var(--studio-hover); }
.studio-ui details.studio-disclosure > summary:focus-visible { outline: 2px solid var(--studio-focus); outline-offset: 2px; }
.studio-ui .studio-disclosure-summary { display: grid; gap: 0; }
.studio-ui .studio-disclosure-summary .studio-muted { font-size: 12px; font-weight: 400; }
.studio-ui .studio-disclosure-body { display: grid; gap: 12px; padding: 4px 16px 16px; border-top: .5px solid var(--studio-line); }
.studio-ui .studio-disclosure-body > :is(p, ol, pre, label, .studio-field, .studio-note) { margin: 0; }
.studio-ui .studio-disclosure-body ol { padding-top: 12px; }
.studio-ui .studio-disclosure-body li { margin-bottom: 4px; }

/* Dialog header and body spacing. */
.studio-ui .studio-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.studio-ui .studio-dialog-head h2, .studio-ui .studio-dialog-head h3 { margin: 0; }
.studio-ui .studio-dialog-actions { justify-content: flex-end; }
.studio-ui .studio-selection-detail > h3 { margin: 0; font-size: 15px; }

/* Unified selection card: title row, optional mono subtitle, two-line excerpt, actions bottom-right. */
.studio-ui .studio-transfer-items { max-height: 520px; }
.studio-ui .studio-transfer-items > .studio-transfer-card { display: flex; flex-direction: column; gap: 4px; min-height: 0; padding: 12px 14px; }
.studio-ui .studio-transfer-card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.studio-ui .studio-transfer-card-head strong { flex: 1 1 auto; min-width: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.studio-ui .studio-transfer-card-subtitle { overflow: hidden; color: var(--studio-subtle); text-overflow: ellipsis; white-space: nowrap; }
.studio-ui .studio-transfer-card .studio-card-excerpt { margin: 0; font-size: 12px; line-height: 1.55; }
.studio-ui .studio-transfer-card-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: auto; padding-top: 6px; }
.studio-ui .studio-transfer-card-actions .studio-button { margin: 0; }
.studio-ui .studio-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Split button: main action joined to a caret menu. */
.studio-ui .studio-split { position: relative; display: inline-flex; }
.studio-ui .studio-split .studio-button { margin: 0; }
.studio-ui .studio-split[data-menu=true] > .studio-button:first-child { border-start-end-radius: 0; border-end-end-radius: 0; }
.studio-ui .studio-split .studio-split-caret { width: 26px; padding: 0; margin-inline-start: -.5px; border-start-start-radius: 0; border-end-start-radius: 0; }
.studio-ui .studio-split .studio-button.studio-primary.studio-split-caret { border-inline-start: .5px solid var(--studio-on-primary); }
.studio-ui .studio-split-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 5; display: grid; min-width: 140px; padding: 4px; border: .5px solid var(--studio-line); border-radius: var(--studio-control-radius); background: var(--studio-bg); }
.studio-ui .studio-split-menu button { padding: 6px 10px; border: 0; border-radius: var(--studio-small-radius); background: none; color: var(--studio-ink); font: inherit; font-size: 12px; text-align: start; white-space: nowrap; cursor: pointer; }
.studio-ui .studio-split-menu button:hover { background: var(--studio-hover); }

/* Detail dialog: header, scrolling body, optional footer. */
.studio-ui .studio-detail-dialog { width: min(680px, calc(100vw - 48px)); max-height: calc(100dvh - 64px); overflow: hidden; }
.studio-ui .studio-detail-dialog[open] { display: flex; }
.studio-ui .studio-dialog { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; width: 100%; }
.studio-ui .studio-dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 14px; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-dialog > header h2 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.studio-ui .studio-dialog > header p { margin: 2px 0 0; font-size: 12px; }
.studio-ui .studio-dialog > header .studio-button { margin: 0; flex: 0 0 auto; }
.studio-ui .studio-dialog .studio-dialog-body { flex: 1 1 auto; min-height: 0; margin: 0; border: 0; border-radius: 0; padding: 16px 20px 20px; overflow-y: auto; }
.studio-ui .studio-dialog > footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: .5px solid var(--studio-line); }
.studio-ui .studio-dialog > footer .studio-button { margin: 0; }
.studio-ui .studio-dialog > footer .studio-button:first-child:not(:last-child) { margin-inline-end: auto; }
.studio-ui .studio-dialog-body .studio-field-grid .studio-field { margin: 0 0 12px; }
.studio-ui .studio-dialog-body fieldset.studio-config-root { margin: 0; }
.studio-ui .studio-dialog-body > .studio-button, .studio-ui .studio-dialog-body section > .studio-button { justify-self: start; margin: 0; }
.studio-ui .studio-dialog-body section { display: grid; gap: 8px; }
.studio-ui .studio-dialog-body section > .studio-field { margin: 0; }

/* Item picker: one list, rows stay in place when toggled; filters show selected or modified rows. */
.studio-ui .studio-picker { display: grid; gap: 10px; min-width: 0; }
.studio-ui .studio-picker-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.studio-ui .studio-picker-bar input[type=search] { flex: 1 1 240px; width: auto; }
.studio-ui .studio-picker-filters { display: inline-flex; flex: 0 0 auto; padding: 2px; border-radius: var(--studio-control-radius); background: var(--studio-neutral-fill); }
.studio-ui .studio-picker-filter { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border: 0; border-radius: var(--studio-small-radius); background: none; color: var(--studio-muted); font: inherit; font-size: 12px; cursor: pointer; }
.studio-ui .studio-picker-filter[aria-checked=true] { background: var(--studio-bg); color: var(--studio-ink); font-weight: 500; }
.studio-ui .studio-picker-filter .studio-count { margin-inline-start: 4px; }
.studio-ui ul.studio-picker-list { display: grid; max-height: 480px; margin: 0; padding: 0; overflow-y: auto; list-style: none; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui .studio-picker-row { display: flex; align-items: center; gap: 8px; margin: 0; padding: 0 12px 0 0; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-picker-row:last-child { border-bottom: 0; }
.studio-ui .studio-picker-row[data-selected=true] { background: var(--studio-hover); }
.studio-ui .studio-picker-row > .studio-button { margin: 0; flex: 0 0 auto; }
.studio-ui .studio-picker-toggle { display: flex; flex: 1 1 auto; align-items: flex-start; gap: 12px; min-width: 0; padding: 10px 4px 10px 14px; border: 0; background: none; color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-picker-toggle:focus-visible { outline-offset: -2px; }
.studio-ui .studio-picker-check { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 18px; height: 18px; margin-top: 1px; border: 1px solid var(--studio-control-line); border-radius: 5px; color: transparent; }
.studio-ui .studio-picker-toggle[aria-checked=true] .studio-picker-check { border-color: var(--studio-primary-fill); background: var(--studio-primary-fill); color: var(--studio-on-primary); }
.studio-ui .studio-picker-text { display: grid; gap: 2px; min-width: 0; }
.studio-ui .studio-picker-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-weight: 500; overflow-wrap: anywhere; }
.studio-ui .studio-picker-subtitle { color: var(--studio-subtle); font-weight: 400; }
.studio-ui .studio-picker-description { display: -webkit-box; overflow: hidden; color: var(--studio-muted); font-size: 12px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.studio-ui .studio-picker-empty { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; padding: 14px; color: var(--studio-muted); }
.studio-ui .studio-picker-empty .studio-button { margin: 0; }

/* Prompt preview: sections read as a document on the left, tool schemas sit in a right rail. */
.studio-ui .studio-detail-dialog.studio-dialog-compact { width: min(440px, calc(100vw - 48px)); }
.studio-ui .studio-dialog-compact .studio-dialog > header { border-bottom: 0; padding-bottom: 0; }
.studio-ui .studio-dialog-compact .studio-dialog .studio-dialog-body { padding-top: 10px; padding-bottom: 4px; }
.studio-ui .studio-dialog-compact .studio-dialog > footer { border-top: 0; padding-bottom: 18px; }
.studio-ui .studio-dialog-compact .studio-dialog > footer .studio-button:first-child:not(:last-child) { margin-inline-end: 0; }
/* Preset identity: one card, short name beside a wider description, quiet labels. */
.studio-ui .studio-identity { display: grid; grid-template-columns: minmax(200px, 2fr) minmax(0, 3fr); gap: 12px var(--studio-gap); padding: 14px 16px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui .studio-identity > label.studio-field { margin: 0; gap: 4px; }
.studio-ui .studio-identity > label.studio-field > span { color: var(--studio-subtle); font-size: 12px; }
.studio-ui .studio-identity input:not([type=checkbox]) { min-height: 36px; background: var(--studio-bg); }
.studio-ui .studio-identity .studio-identity-name input { font-size: 15px; font-weight: 500; }
@media (max-width: 720px) { .studio-ui .studio-identity { grid-template-columns: minmax(0, 1fr); } }
.studio-ui .studio-detail-dialog.studio-dialog-wide { width: min(1180px, calc(100vw - 48px)); height: calc(100dvh - 64px); }
.studio-ui .studio-dialog-wide .studio-dialog-body { display: flex; flex-direction: column; padding-bottom: 16px; }
.studio-ui .studio-preview { display: grid; flex: 1 1 auto; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; min-height: 0; }
.studio-ui .studio-preview-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.studio-ui .studio-preview .studio-prompt-document { max-height: none; min-height: 0; overflow-y: auto; border: .5px solid var(--studio-line); background: var(--studio-bg); }
.studio-ui .studio-preview .studio-prompt-section { display: block; padding: 14px 18px; border-inline-start: 0; }
.studio-ui .studio-preview .studio-prompt-section h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; color: var(--studio-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 400; }
.studio-ui .studio-prompt-index { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--studio-neutral-fill); color: var(--studio-muted); font-family: inherit; font-size: 11px; }
.studio-ui .studio-preview .studio-prompt-section > p { font-size: 13px; line-height: 1.65; }
.studio-ui .studio-preview .studio-prompt-tools { min-height: 0; overflow-y: auto; padding: 12px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui .studio-preview .studio-prompt-tools h3 { margin: 0 0 8px; font-size: 13px; }
.studio-ui .studio-preview .studio-schema-tool > summary { display: flex; align-items: center; gap: 8px; list-style: none; }
.studio-ui .studio-preview .studio-schema-tool > summary::-webkit-details-marker { display: none; }
.studio-ui .studio-preview .studio-schema-tool > summary::before { content: ''; width: 5px; height: 5px; border-right: 1.3px solid var(--studio-muted); border-bottom: 1.3px solid var(--studio-muted); transform: rotate(-45deg); }
.studio-ui .studio-preview .studio-schema-tool[open] > summary::before { transform: rotate(45deg); }
.studio-ui .studio-preview .studio-schema-tool { margin-top: 6px; padding: 8px 10px; background: var(--studio-bg); }
.studio-ui .studio-preview .studio-schema-tool summary { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.studio-ui .studio-preview .studio-schema-tool p { font-size: 12px; }
.studio-ui .studio-schema-params { display: grid; gap: 8px; margin-top: 8px; font-size: 12px; }
.studio-ui .studio-schema-param { display: grid; gap: 4px; min-width: 0; }
.studio-ui .studio-schema-param .studio-schema-param { margin-top: 4px; padding-inline-start: 10px; border-inline-start: 1px solid var(--studio-line); }
.studio-ui .studio-schema-param-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; min-width: 0; }
.studio-ui .studio-schema-param-head code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 500; overflow-wrap: anywhere; }
.studio-ui .studio-schema-required { color: var(--studio-warn); font-size: 11px; }
.studio-ui .studio-schema-param p { margin: 0; color: var(--studio-muted); line-height: 1.5; }
.studio-ui .studio-schema-constraints { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-schema-constraints li { padding: 0 6px; border-radius: var(--studio-small-radius); background: var(--studio-neutral-fill); color: var(--studio-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; }
.studio-ui .studio-schema-constraints li > span { color: var(--studio-subtle); }
.studio-ui .studio-schema-constraint { color: var(--studio-muted); overflow-wrap: anywhere; }
@container studio-shell (max-width: 900px) { .studio-ui .studio-preview { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 2fr) minmax(0, 1fr); } }

/* Width rules follow the Studio surface and its content column, which the host sidebar and the Studio navigation narrow. */
@container studio-shell (max-width: 760px) {
  .studio-ui .studio-page { overflow-y: auto; }
  .studio-ui .studio-layout { grid-template-columns: 1fr; height: auto; }
  .studio-ui nav.studio-nav { flex-direction: row; overflow-x: auto; padding: 8px 12px; border-inline-end: 0; border-bottom: .5px solid var(--studio-line); }
  .studio-ui .studio-nav-group { display: none; }
  .studio-ui .studio-nav-item { flex: 0 0 auto; }
  .studio-ui .studio-nav-footer { margin: 0 0 0 auto; padding: 0 0 0 8px; }
  .studio-ui .studio-scroller { overflow: visible; }
}
@container studio-main (max-width: 560px) {
  .studio-ui .studio-tool-cards.studio-card-pair { grid-template-columns: minmax(0, 1fr); }
}
@container studio-main (max-width: 640px) {
  .studio-ui .studio-master-detail { grid-template-columns: 1fr; }
  .studio-ui nav.studio-list { position: static; flex-direction: row; flex-wrap: wrap; }
  .studio-ui .studio-list-group { display: none; }
  .studio-ui .studio-component-summary { display: none; }
  .studio-ui .studio-facts { grid-template-columns: 1fr; gap: 4px; }
}
.studio-ui .studio-subscription-meter { display: grid; gap: 6px; font-size: 12px; }
.studio-ui .studio-subscription-meter progress { width: 100%; height: 6px; accent-color: var(--studio-muted); }
.studio-ui .studio-settings-card { min-width: 0; overflow-wrap: anywhere; }
/* Settings card rows, segmented choice, and switch (shapes follow DSH Settings, SegmentedControl, and Switch). */
.studio-ui .studio-settings-card { padding: 4px 20px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui .studio-settings-row { display: grid; gap: 10px; padding: 14px 0; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-settings-row:last-child { border-bottom: 0; }
.studio-ui .studio-settings-row-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px; }
.studio-ui .studio-settings-row-text { display: grid; gap: 2px; min-width: 0; flex: 1 1 220px; }
.studio-ui .studio-settings-row-text .studio-muted { font-size: 12px; }
.studio-ui .studio-settings-row-control { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.studio-ui .studio-settings-row-control select, .studio-ui .studio-settings-row-control input:not([type=checkbox]) { width: auto; min-width: 160px; max-width: 260px; }
.studio-ui .studio-segmented { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--studio-control-radius); background: var(--studio-hover); }
.studio-ui .studio-segmented button { padding: 3px 10px; border: 0; border-radius: var(--studio-small-radius); background: none; color: var(--studio-muted); font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer; }
.studio-ui .studio-segmented button[aria-checked=true] { background: var(--studio-surface); color: var(--studio-ink); box-shadow: 0 0 0 .5px var(--studio-control-line); }
.studio-ui .studio-toggle { position: relative; flex: none; width: 32px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: var(--studio-control-line); cursor: pointer; }
.studio-ui .studio-toggle > span { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--studio-surface); }
.studio-ui .studio-toggle[aria-checked=true] { background: var(--studio-primary-fill); }
.studio-ui .studio-toggle[aria-checked=true] > span { left: 16px; background: var(--studio-on-primary); }
/* Compact selects: small text, tight padding, used in dense panels. */
.studio-ui select.studio-compact, .studio-ui input.studio-compact { min-height: 28px; padding: 3px 26px 3px 8px; font-size: 12px; background-position: right 13px top 50%, right 9px top 50%; background-size: 4px 4px, 4px 4px; }
.studio-ui input.studio-compact { padding-inline-end: 8px; }
/* Pixie: settings service (shares DetailLayout) and the right-sidebar tab. */
.studio-ui .studio-pixie-prompt { min-height: 160px; font-size: 12px; }
.studio-ui.studio-pixie { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 0 12px 12px; overflow-y: auto; background: var(--studio-bg); container: studio-pixie / inline-size; }
.studio-ui.studio-pixie > * { flex-shrink: 0; }
.studio-ui.studio-pixie .studio-tab-panel { min-height: 0; }
.studio-ui .studio-pixie-chat, .studio-ui .studio-pixie-judge { display: grid; gap: 8px; padding-top: 12px; }
/* Thread overview beside the open thread; narrow panes show one of them at a time. */
.studio-ui .studio-pixie-threads { display: grid; grid-template-columns: minmax(200px, 260px) minmax(0, 1fr); gap: 16px; align-items: start; }
.studio-ui .studio-pixie-list { display: grid; gap: 8px; min-width: 0; }
.studio-ui .studio-pixie-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
.studio-ui .studio-pixie-list-title { color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-pixie-list-head .studio-icon-button, .studio-ui .studio-pixie-detail-head .studio-icon-button { color: var(--studio-muted); }
.studio-ui .studio-pixie-detail-head .studio-icon-button[data-tone=error]:hover:not(:disabled) { color: var(--studio-error); }
.studio-ui .studio-pixie-new { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px; border-radius: var(--studio-control-radius); background: var(--studio-hover); }
.studio-ui .studio-pixie-new select { width: auto; flex: 1 1 120px; }
.studio-ui ul.studio-pixie-thread-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-pixie-thread-list > li { margin: 0; }
.studio-ui .studio-pixie-thread { display: grid; gap: 4px; width: 100%; padding: 10px 12px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-pixie-thread:hover { background: var(--studio-hover); }
.studio-ui .studio-pixie-thread[aria-current] { border-color: var(--studio-ink); background: var(--studio-hover); }
.studio-ui .studio-pixie-thread .studio-card-head strong { font-size: 13px; font-weight: 500; }
.studio-ui .studio-pixie-thread-preview { overflow: hidden; color: var(--studio-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.studio-ui .studio-pixie-detail { display: grid; gap: 10px; min-width: 0; padding: 12px 16px 16px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); }
.studio-ui .studio-pixie-detail-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.studio-ui .studio-pixie-detail-head > .studio-card-head { flex: 1 1 auto; }
.studio-ui .studio-pixie-detail-head .studio-card-head strong { font-size: 14px; font-weight: 500; }
.studio-ui .studio-pixie-back { display: none; }
.studio-ui .studio-card-head > .studio-pixie-title { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.studio-ui .studio-pixie-pin { display: inline-flex; color: var(--studio-info); line-height: 0; }
.studio-ui .studio-pixie-detail-head .studio-pixie-pin-toggle .studio-icon-button { color: var(--studio-subtle); }
.studio-ui .studio-pixie-detail-head .studio-pixie-pin-toggle .studio-icon-button:hover { color: var(--studio-ink); }
.studio-ui .studio-pixie-detail-head .studio-pixie-pin-toggle[data-target=true] .studio-icon-button { color: var(--studio-info); cursor: default; }
.studio-ui .studio-pixie-turns { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-pixie-turn { display: grid; gap: 4px; margin: 0; padding-bottom: 10px; border-bottom: .5px solid var(--studio-line); }
.studio-ui .studio-pixie-question { justify-self: end; max-width: 85%; margin: 0; padding: 4px 10px; border-radius: var(--studio-control-radius); background: var(--studio-hover); white-space: pre-wrap; }
.studio-ui .studio-pixie-answer { margin: 0; white-space: pre-wrap; }
.studio-ui .studio-markdown { white-space: normal; min-width: 0; overflow-wrap: anywhere; }
.studio-ui .studio-pixie-turn-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.studio-ui .studio-pixie-turn-meta:empty { display: none; }
.studio-ui .studio-pixie-detail > p { margin: 0; }
.studio-ui .studio-pixie-error { margin: 0; color: var(--studio-error); font-size: 12px; }
.studio-ui .studio-pixie-compose { display: grid; gap: 0; border: .5px solid var(--studio-control-line); border-radius: var(--studio-radius); background: var(--studio-bg); }
.studio-ui .studio-pixie-compose textarea { min-height: 52px; border: 0; background: none; resize: none; }
.studio-ui .studio-pixie-compose textarea:focus-visible { outline: 0; }
.studio-ui .studio-pixie-compose:focus-within { border-color: var(--studio-ink); }
.studio-ui .studio-pixie-compose-bar { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 4px 6px 6px 10px; }
@container studio-pixie (max-width: 560px) {
  .studio-ui .studio-pixie-threads { grid-template-columns: minmax(0, 1fr); }
  .studio-ui .studio-pixie-threads[data-open=true] > .studio-pixie-list, .studio-ui .studio-pixie-threads[data-open=false] > .studio-pixie-detail { display: none; }
  .studio-ui .studio-pixie-back { display: inline-flex; }
}
.studio-ui .studio-pixie-judge textarea { min-height: 64px; font-size: 12px; }
.studio-ui .studio-pixie-actions { justify-content: flex-end; }
.studio-ui .studio-pixie-answers { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.studio-ui .studio-pixie-answers dd { margin: 0; }
.studio-ui.studio-pixie-command { margin: 4px 0; }
.studio-ui .studio-pixie-row { display: grid; gap: 6px; padding: 10px 12px; border: .5px solid var(--studio-line); border-radius: var(--studio-radius); background: var(--studio-surface); font-size: 13px; }
.studio-ui .studio-pixie-row-head { display: flex; align-items: center; gap: 8px; }
.studio-ui .studio-pixie-row-question { min-width: 0; flex: 1 1 auto; color: var(--studio-muted); white-space: pre-wrap; }
.studio-ui .studio-pixie-row p { margin: 0; }
/* Pixie Gate: composition cards, composer flow, and step panel. */
.studio-ui .studio-gate-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--studio-muted); }
.studio-ui .studio-gate-strip > li { padding: 1px 8px; border: .5px solid var(--studio-line); border-radius: var(--studio-small-radius); background: var(--studio-inset); }
.studio-ui .studio-gate-strip > li + li::before { content: '→'; margin-inline-end: 6px; color: var(--studio-subtle); }
.studio-ui .studio-gate-composer { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 16px; align-items: start; min-height: 0; }
.studio-ui .studio-gate-composer > .studio-notice-row { grid-column: 1 / -1; }
.studio-ui .studio-gate-flow { position: sticky; top: 0; display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-gate-flow > li { position: relative; margin: 0; }
.studio-ui .studio-gate-flow > li:not(:last-child)::after { content: ''; position: absolute; inset-inline-start: 18px; bottom: -6px; height: 6px; border-inline-start: 1px solid var(--studio-control-line); }
.studio-ui .studio-gate-flow > li + li { margin-top: 6px; }
.studio-ui .studio-gate-node { display: grid; gap: 2px; width: 100%; padding: 8px 12px; border: .5px solid var(--studio-line); border-radius: var(--studio-control-radius); background: var(--studio-surface); color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-gate-node:hover { background: var(--studio-hover); }
.studio-ui .studio-gate-node[aria-current=step] { border-color: var(--studio-ink); background: var(--studio-hover); }
.studio-ui .studio-gate-node-kind { color: var(--studio-subtle); font-size: 11px; }
.studio-ui .studio-gate-node-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-weight: 500; overflow-wrap: anywhere; }
.studio-ui .studio-gate-node-title code { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; font-size: 12px; }
.studio-ui .studio-gate-node-meta { color: var(--studio-muted); font-size: 12px; overflow-wrap: anywhere; }
.studio-ui .studio-gate-node-meta:empty { display: none; }
.studio-ui .studio-gate-flow > li.studio-gate-add { display: flex; justify-content: center; margin-top: 2px; }
.studio-ui .studio-gate-flow > li.studio-gate-add + li { margin-top: 2px; }
.studio-ui .studio-gate-flow > li.studio-gate-add .studio-button { min-width: 28px; margin: 0; padding: 0 8px; }
.studio-ui .studio-gate-panel { display: grid; gap: 12px; min-width: 0; }
.studio-ui .studio-gate-panel > .studio-settings-row:first-of-type { padding-top: 0; }
.studio-ui .studio-gate-io { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.studio-ui .studio-gate-io > div { display: grid; align-content: start; gap: 4px; padding: 10px 12px; border-radius: var(--studio-small-radius); background: var(--studio-inset); font-size: 12px; overflow-wrap: anywhere; }
.studio-ui .studio-gate-io p { margin: 0; }
.studio-ui .studio-gate-io-label { color: var(--studio-subtle); font-size: 11px; font-weight: 500; }
.studio-ui .studio-gate-vars { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; }
.studio-ui .studio-gate-vars code { padding: 1px 6px; border-radius: var(--studio-small-radius); background: var(--studio-inset); }
.studio-ui textarea.studio-gate-code { min-height: 96px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
/* Pixie Gate task preview (R1): sentence cards and two-field editor. */
.studio-ui .studio-gate-sentence { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 0; font-size: 13px; }
.studio-ui .studio-gate-sentence > span:first-child { color: var(--studio-muted); }
.studio-ui .studio-gate-sentence > span[aria-hidden] { color: var(--studio-subtle); }
.studio-ui .studio-gate-sentence > span:last-child { min-width: 0; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.studio-ui .studio-gate-task { display: grid; gap: 12px; min-width: 0; }
.studio-ui textarea.studio-gate-instruction { min-height: 140px; }
.studio-ui .studio-gate-folder { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.studio-ui .studio-gate-folder input { flex: 1 1 260px; width: auto; min-width: 0; }
.studio-ui .studio-gate-folder .studio-button { margin: 0; }
.studio-ui .studio-gate-scope-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; min-height: 32px; }
.studio-ui .studio-gate-scope-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
.studio-ui .studio-gate-scope-title strong { font-weight: 500; }
.studio-ui .studio-gate-scope-actions { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 8px; margin-inline-start: auto; }
.studio-ui .studio-gate-scope-actions .studio-button { margin: 0; min-width: 104px; justify-content: center; }
.studio-ui .studio-gate-scope-switch { display: inline-flex; justify-content: flex-end; width: 36px; }
.studio-ui ul.studio-gate-scope-list { display: grid; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-gate-scope-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; min-height: 32px; margin: 0; padding: 8px 0; border-top: .5px solid var(--studio-line); }
.studio-ui .studio-gate-scope-row:first-child { border-top: 0; }
.studio-ui .studio-gate-scope-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
.studio-ui .studio-gate-scope-name strong { font-weight: 500; }
.studio-ui .studio-pixie-thread.studio-gate-run-item { gap: 2px; padding: 6px 10px; }
.studio-ui .studio-gate-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; align-items: baseline; margin: 0; font-size: 13px; }
.studio-ui .studio-gate-facts dt { color: var(--studio-muted); font-size: 12px; }
.studio-ui .studio-gate-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.studio-ui .studio-loop-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-ui ul.studio-loop-items, .studio-ui ol.studio-loop-attempts { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.studio-ui .studio-loop-item { display: grid; gap: 2px; width: 100%; padding: 8px 10px; border: .5px solid var(--studio-line); border-radius: var(--studio-control-radius); background: var(--studio-surface); color: var(--studio-ink); font: inherit; text-align: start; cursor: pointer; }
.studio-ui .studio-loop-item:hover, .studio-ui .studio-loop-item[aria-expanded=true] { background: var(--studio-hover); }
.studio-ui .studio-loop-spec { width: 100%; min-height: 160px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.studio-ui .studio-loop-attempt { display: grid; gap: 6px; padding: 8px 10px; border-inline-start: 2px solid var(--studio-line); }
.studio-ui .studio-gate-block { display: grid; gap: 6px; padding-top: 10px; border-top: .5px solid var(--studio-line); }
.studio-ui .studio-gate-session-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.studio-ui .studio-gate-session-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.studio-ui .studio-gate-session-name { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.studio-ui.studio-gate-tail { margin: 6px 0 2px; }
.studio-ui .studio-gate-tail-body { display: grid; gap: 6px; padding: 10px 12px; border: .5px solid var(--studio-line); border-radius: 8px; }
.studio-ui .studio-gate-tail-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; }
.studio-ui .studio-gate-tail-head .studio-inline-actions { margin-left: auto; }
.studio-ui .studio-gate-block > .studio-section-head, .studio-ui .studio-gate-block h3 { margin: 0; }
.studio-ui .studio-gate-text { max-height: 168px; overflow: auto; padding: 8px 10px; border-radius: var(--studio-small-radius); background: var(--studio-hover); font-size: 12px; overflow-wrap: anywhere; }
.studio-ui .studio-gate-compact { display: grid; gap: 10px; }
.studio-ui .studio-gate-path { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.studio-ui .studio-gate-path code { padding: 1px 6px; border-radius: var(--studio-small-radius); background: var(--studio-inset); overflow-wrap: anywhere; }
.studio-ui .studio-gate-path .studio-button { margin: 0; }
.studio-ui .studio-provider-credential { display: grid; gap: 6px; }
.studio-ui .studio-provider-credential > p { margin: 0; }
.studio-ui .studio-inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.studio-ui .studio-inline-form input { flex: 1 1 200px; width: auto; max-width: 320px; }
.studio-ui .studio-inline-form .studio-button { margin: 0; }
.studio-ui .studio-gate-judge { display: grid; gap: 8px; }
.studio-ui .studio-gate-judge .studio-field { margin: 0; }
.studio-ui .studio-gate-trial { display: grid; gap: 8px; padding-top: 12px; border-top: .5px solid var(--studio-line); }
.studio-ui .studio-gate-trial p, .studio-ui .studio-gate-trial h3 { margin: 0; }
.studio-ui .studio-gate-result { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 13px; }
.studio-ui .studio-gate-result dd { margin: 0; overflow-wrap: anywhere; }
.studio-ui .studio-gate-chips { display: flex; flex-wrap: nowrap; gap: 4px; overflow: hidden; mask-image: linear-gradient(to right, black 85%, transparent); }
.studio-ui .studio-gate-preset-list { display: grid; gap: 2px; max-height: 320px; overflow-y: auto; }
.studio-ui .studio-pick-disabled { cursor: default; opacity: .6; }
.studio-ui .studio-pick-disabled:hover { background: transparent; }
/* The composer lives in the top layer, so it narrows on its own width rather than the shell's. */
.studio-ui .studio-gate-composer-frame { container: studio-gate / inline-size; }
@container studio-gate (max-width: 720px) {
  .studio-ui .studio-gate-composer { grid-template-columns: minmax(0, 1fr); }
  .studio-ui .studio-gate-flow { position: static; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
  .studio-ui .studio-gate-flow > li, .studio-ui .studio-gate-flow > li + li, .studio-ui .studio-gate-flow > li.studio-gate-add + li { flex: 0 0 auto; margin: 0; }
  .studio-ui .studio-gate-flow > li:not(:last-child)::after { display: none; }
  .studio-ui .studio-gate-flow > li.studio-gate-add { align-items: center; }
  .studio-ui .studio-gate-node { width: auto; max-width: 180px; }
  .studio-ui .studio-gate-node-meta { display: none; }
  .studio-ui .studio-gate-io { grid-template-columns: minmax(0, 1fr); }
}
/* Subagents conversation view: centered like the chat column, narrows on its own width. */
.studio-ui.studio-session-roles-view { container: studio-session-roles / inline-size; width: 100%; max-width: 960px; margin: 0 auto; padding: 20px 24px 32px; box-sizing: border-box; }
@container studio-session-roles (max-width: 560px) {
  .studio-ui.studio-session-roles-view { padding: 16px 12px 24px; }
  .studio-ui .studio-session-roles .studio-tool-cards.studio-card-pair { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 480px) {
  .studio-ui .studio-card, .studio-ui article, .studio-ui .studio-agents { padding: 12px; }
  .studio-ui dl { grid-template-columns: 1fr; gap: 4px; }
  .studio-ui dd { margin-bottom: 8px; }
}
`;

/** Styles for the update mark Studio places inside the host sidebar's own row; scoped like the rest. */
export const sidebarMarkStyles = `${adapter}
.studio-ui.studio-sidebar-glyph { display: inline-flex; color: inherit; line-height: 0; }
.studio-ui .studio-sidebar-dot { fill: var(--studio-info); }
/* order keeps the mark last even if the sidebar later appends its own label. */
.studio-ui.studio-sidebar-update { display: inline-flex; flex: none; align-items: center; order: 99; margin-left: auto; color: var(--studio-info); line-height: 0; }
.studio-ui.studio-sidebar-update[data-phase=failed] { color: var(--studio-error); }
`;
