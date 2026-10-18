import { isDelegationPlugin } from './delegation.ts';
import { pluginPurpose, pluginTitle } from './plugin-labels.ts';
import React from 'react';
import { hasChangedOverride } from './change-indicator.tsx';
import { Button } from './ui.tsx';
import { ItemPicker, type PickerItem } from './item-picker.tsx';

export interface ConfigEditorProps {
  entries: Array<{ id: string; name: string; schema?: Record<string, unknown>; config?: unknown; error?: string }>;
  value: Record<string, Record<string, unknown>>;
  onChange(value: Record<string, Record<string, unknown>>): void;
  locale: string;
}
type Schema = Record<string, unknown>;
const copy = {
  en: { list: 'Configs', reset: 'Reset override', unavailable: 'Schema unavailable; editing is disabled.', fixed: 'Schema unavailable; editing is disabled. Studio set this value; only restoring the preset defaults changes it.', delegated: 'Merged into subagent_role. Configure subagents in the Subagent settings tab.', inherited: 'Base value (not overridden)', overridden: 'Override', unset: 'Not set', unsupported: 'This schema type is not yet supported by the form. Existing values are preserved; turn off the Config to reset them.', json: 'Config', invalid: 'Enter valid JSON.', object: 'Enter a JSON object.', number: 'Enter a valid number.',
    picker: { filter: 'Show', search: 'Search execution settings', searchHint: 'Search plugin names, fields or descriptions', all: 'All', selected: 'On', modified: 'Modified', settings: 'Edit', done: 'Done', empty: 'No Configs', noResults: 'No matching results.', modifiedTag: 'Modified', clear: 'Show all' }, items: { add: 'Add', remove: 'Remove', draft: 'New item', key: 'New key' } },
  ko: { list: 'Config', reset: '기본값으로', unavailable: '스키마를 읽을 수 없어 편집할 수 없습니다.', fixed: '스키마를 읽을 수 없어 편집할 수 없습니다. Studio가 넣은 값이며, 프리셋을 기본값으로 복구할 때만 바뀝니다.', delegated: 'subagent_role로 통합되었습니다. 서브에이전트 탭에서 설정하세요.', inherited: '기본값', overridden: '변경됨', unset: '미설정', unsupported: '이 형식은 아직 편집할 수 없습니다. 기존 값은 그대로 두며, Config를 끄면 초기화됩니다.', json: 'Config', invalid: '올바른 JSON을 입력하세요.', object: 'JSON 객체를 입력하세요.', number: '올바른 숫자를 입력하세요.',
    picker: { filter: '보기', search: '설정 검색', searchHint: '플러그인 이름, 필드, 설명으로 검색', all: '전체', selected: '켜짐', modified: '변경됨', settings: '설정', done: '완료', empty: '항목이 없습니다.', noResults: '검색 결과가 없습니다.', modifiedTag: '변경됨', clear: '전체 보기' }, items: { add: '추가', remove: '삭제', draft: '새 항목', key: '새 키' } },
  zh: { list: 'Config', reset: '重置覆盖', unavailable: '架构不可用，无法编辑', fixed: '架构不可用，无法编辑。此值由 Studio 设置，仅在将预设恢复为默认值时更改', delegated: '已合并到 subagent_role。请在子代理设置页中配置。', inherited: '基础值（未覆盖）', overridden: '覆盖', unset: '未设置', unsupported: '表单暂不支持此设置类型。保留现有值；关闭 Config 可重置。', json: 'Config', invalid: '请输入有效的 JSON', object: '请输入 JSON 对象', number: '请输入有效的数字',
    picker: { filter: '显示', search: '搜索执行设置', searchHint: '按插件名称、字段或描述搜索', all: '全部', selected: '已开启', modified: '已修改', settings: '设置', done: '完成', empty: '没有 Config', noResults: '没有匹配结果。', modifiedTag: '已修改', clear: '显示全部' }, items: { add: '添加', remove: '删除', draft: '新项', key: '新键' } },
};
type Labels = typeof copy.en;
const own = (value: unknown, key: string) => isObject(value) && Object.hasOwn(value, key);
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function at(value: unknown, path: string[]): unknown { return path.reduce<unknown>((node, key) => own(node, key) ? (node as Schema)[key] : undefined, value); }
function has(value: unknown, path: string[]): boolean { return path.length === 0 || own(at(value, path.slice(0, -1)), path[path.length - 1]!); }
/** Copy only the edited branch; resetting its last leaf prunes empty ancestors. */
function update(value: Schema, path: string[], next: unknown, reset = false): Schema {
  if (!path.length) return (next === undefined ? {} : next) as Schema;
  const [key, ...rest] = path as [string, ...string[]];
  const result = { ...value };
  if (rest.length) {
    const child = update(isObject(value[key]) ? value[key] : {}, rest, next, reset);
    if (reset && !Object.keys(child).length) delete result[key];
    else Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true });
  } else if (reset) delete result[key];
  else Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true });
  return result;
}
function merged(base: unknown, override: unknown): unknown {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(override)])].map(key => [key, own(override, key) ? merged(base[key], override[key]) : base[key]]));
}
function resolve(schema: Schema, root: Schema): Schema {
  const seen = new Set<string>();
  while (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (!ref.startsWith('#/') || seen.has(ref)) return schema;
    seen.add(ref);
    const target = at(root, ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')));
    if (!isObject(target)) return schema;
    const { $ref: _, ...siblings } = schema;
    schema = { ...target, ...siblings };
  }
  return schema;
}
/** Field identity for labels: property names join with `.`, list positions use `[n]`. */
function pathLabel(path: string[]): string {
  return path.reduce((text, segment) => /^\d+$/.test(segment) ? `${text}[${segment}]` : `${text}.${segment}`);
}
const loaderBranch = (branch: unknown): boolean => isObject(branch) && branch.$ref === '#/$defs/loaderExpression';
/** Only the projector's Loader-expression wrapper is structural; every other union stays a notice. */
function unwrapExpression(raw: Schema, root: Schema): Schema {
  const schema = resolve(raw, root);
  if (!Array.isArray(schema.anyOf)) return schema;
  const literal = schema.anyOf.filter(branch => !loaderBranch(branch));
  if (literal.length !== 1 || literal.length === schema.anyOf.length || !isObject(literal[0])) return schema;
  const { anyOf: _, ...metadata } = schema;
  return { ...resolve(literal[0], root), ...metadata };
}
const scalarTypes = ['string', 'number', 'integer', 'boolean'];
/** The single scalar type a schema declares after skipping nullable padding. */
function scalarType(schema: Schema, root: Schema): string | undefined {
  const resolved = unwrapExpression(schema, root);
  const types = (Array.isArray(resolved.type) ? resolved.type : [resolved.type]).filter(type => type !== 'null');
  return types.length === 1 && typeof types[0] === 'string' ? types[0] : undefined;
}
/** One alternative the form can render: a literal, a scalar, or a nested object/array shape. */
function renderable(schema: Schema, root: Schema): Schema | undefined {
  if (schema.const !== undefined || Array.isArray(schema.enum)) return schema;
  const type = scalarType(schema, root);
  if (type !== undefined && scalarTypes.includes(type)) return { ...schema, type };
  if (type === 'object' && !own(schema, 'patternProperties') && (isObject(schema.properties) || isObject(schema.additionalProperties))) return { ...schema, type };
  if (type === 'array' && isObject(schema.items)) return { ...schema, type };
  return undefined;
}
/** Flatten a projected union into renderable alternatives; undefined when a branch is out of reach. */
function unionBranches(raw: Schema, root: Schema, depth = 0): Schema[] | undefined {
  if (depth > 8) return undefined;
  const schema = unwrapExpression(raw, root);
  if (Array.isArray(schema.anyOf)) {
    const branches: Schema[] = [];
    for (const branch of schema.anyOf) {
      const nested = unionBranches(branch, root, depth + 1);
      if (nested === undefined) return undefined;
      branches.push(...nested);
    }
    return branches;
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  if (schema.type !== undefined && !types.some(type => type !== 'null')) return [];
  const branch = renderable(schema, root);
  return branch === undefined ? undefined : [branch];
}
function matchesChoice(choice: Schema, value: unknown): boolean {
  if (choice.const !== undefined) return Object.is(choice.const, value);
  if (Array.isArray(choice.enum)) return choice.enum.some(item => Object.is(item, value));
  if (choice.type === 'object') return isObject(value);
  if (choice.type === 'array') return Array.isArray(value);
  if (choice.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (choice.type === 'number') return typeof value === 'number';
  if (choice.type === 'boolean') return typeof value === 'boolean';
  return choice.type === 'string' && typeof value === 'string';
}
function choiceLabel(choice: Schema): string {
  if (choice.const !== undefined) return typeof choice.const === 'string' ? choice.const : JSON.stringify(choice.const);
  if (Array.isArray(choice.enum)) return choice.enum.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(', ');
  if (typeof choice.title === 'string') return choice.title;
  return String(choice.type ?? 'value');
}
/** Concrete value for a chosen branch; a union default sits on the wrapper, not on the branch. */
function seedChoice(choice: Schema, fallback: unknown): unknown {
  if (matchesChoice(choice, fallback)) return fallback;
  if (matchesChoice(choice, choice.default)) return choice.default;
  if (choice.type === 'object') return {};
  if (choice.type === 'array') return [];
  if (choice.type === 'number' || choice.type === 'integer') return typeof choice.minimum === 'number' ? choice.minimum : 0;
  return choice.type === 'boolean' ? false : '';
}
/** New value for an appended list item, dictionary value, or chosen branch. */
function emptyValue(raw: Schema, root: Schema): unknown {
  const schema = unwrapExpression(raw, root);
  if (Array.isArray(schema.anyOf)) {
    const branches = unionBranches(schema, root);
    const first = branches?.[0];
    if (first !== undefined) return emptyValue(first, root);
  }
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.default !== undefined && schema.default !== null) return JSON.parse(JSON.stringify(schema.default));
  if (schema.type === 'object') return {};
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return typeof schema.minimum === 'number' ? schema.minimum : 0;
  return '';
}

function Field({ schema: raw, root, path, base, override, change, labels, entryId, depth = 0, locked = false, bare = false, labelPath }: {
  schema: Schema; root: Schema; path: string[]; base: unknown; override: unknown;
  change(path: string[], value: unknown, reset?: boolean): void; labels: Labels; entryId: string; depth?: number; locked?: boolean; bare?: boolean; labelPath?: string[];
}) {
  const keys = labelPath ?? path;
  const inherited = merged(at(base, path), at(override, path));
  // Public projector wraps literal values in a Loader-expression union, including
  // the root object. Only unwrap that known union, never arbitrary alternatives.
  const expression = isObject(inherited) && own(inherited, '__jsExpr');
  let schema = expression ? resolve(raw, root) : unwrapExpression(raw, root);
  const alternatives = expression ? undefined : unionBranches(schema, root);
  // A union with one real alternative is the projector's nullable wrapper, not a choice.
  if (alternatives?.length === 1) {
    const { anyOf: _, ...metadata } = schema;
    schema = { ...metadata, ...alternatives[0] };
  }
  if (inherited !== null && Array.isArray(schema.type)) {
    const types = schema.type.filter(type => type !== 'null');
    if (types.length === 1) schema = { ...schema, type: types[0] };
  }
  const disabled = locked || schema.readOnly === true;
  const overridden = path.length > 0 && has(override, path);
  const current = inherited === undefined ? schema.default : inherited;
  const label = `${entryId}: ${keys.length ? pathLabel(keys) : labels.json}`;
  const id = React.useId();
  const [draft, setDraft] = React.useState('');
  const [chosen, setChosen] = React.useState<number>();
  const union = alternatives !== undefined && alternatives.length > 1 ? alternatives : undefined;
  const properties = isObject(schema.properties) ? schema.properties : undefined;
  const values = !properties && !own(schema, 'patternProperties') && isObject(schema.additionalProperties) ? schema.additionalProperties : undefined;
  const items = schema.type === 'array' && isObject(schema.items) ? schema.items : undefined;
  const reset = overridden && !bare && <Button small disabled={disabled} aria-label={`${labels.reset}: ${label}`} onClick={() => change(path, undefined, true)}>{labels.reset}</Button>;
  if (properties) return <fieldset disabled={disabled} className={bare ? 'studio-config-item' : path.length ? undefined : 'studio-config-root'}>
    {!bare && keys.length > 0 && <legend>{typeof schema.title === 'string' ? schema.title : keys[keys.length - 1]}</legend>}
    {!bare && typeof schema.description === 'string' && <p className="studio-muted">{schema.description}</p>}
    {reset}
    {Object.entries(properties).map(([key, child]) => <Field key={key} schema={isObject(child) ? child : { readOnly: child === false }} root={root} path={[...path, key]} labelPath={[...keys, key]} base={base} override={override} change={change} labels={labels} entryId={entryId} depth={depth + 1} locked={disabled} />)}

  </fieldset>;
  /** One scalar control; undefined when the schema is a shape this form does not render. */
  const scalarControl = (target: Schema, value: unknown, ariaLabel: string, controlId: string | undefined, onValue: (next: unknown) => void): React.ReactNode => {
    const choices = target.const !== undefined ? [target.const] : Array.isArray(target.enum) ? target.enum : undefined;
    if (choices) {
      const selected = choices.findIndex(item => JSON.stringify(item) === JSON.stringify(value));
      return <select id={controlId} aria-label={ariaLabel} value={String(selected)} disabled={disabled} onChange={event => onValue(choices[Number(event.target.value)])}>
        <option value="-1" disabled>{value === undefined ? labels.unset : JSON.stringify(value)}</option>
        {choices.map((item, index) => <option key={index} value={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</option>)}
      </select>;
    }
    if (target.type === 'boolean') {
      return <select id={controlId} aria-label={ariaLabel} value={typeof value === 'boolean' ? String(value) : ''} disabled={disabled} onChange={event => onValue(event.target.value === 'true')}>
        <option value="" disabled>{labels.unset}</option><option value="true">true</option><option value="false">false</option>
      </select>;
    }
    if (target.type === 'number' || target.type === 'integer') {
      return <input id={controlId} aria-label={ariaLabel} type="number" disabled={disabled} value={typeof value === 'number' ? value : ''} step={target.type === 'integer' ? 1 : 'any'} min={typeof target.minimum === 'number' ? target.minimum : undefined} max={typeof target.maximum === 'number' ? target.maximum : undefined} onChange={event => {
        const number = event.target.valueAsNumber;
        if (Number.isFinite(number) && (target.type !== 'integer' || Number.isInteger(number))) { event.target.setCustomValidity(''); onValue(number); }
        else event.target.setCustomValidity(labels.number);
      }} />;
    }
    if (target.type === 'string') return <input id={controlId} aria-label={ariaLabel} type={target.format === 'password' || target.writeOnly === true ? 'password' : 'text'} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={event => onValue(event.target.value)} />;
    return undefined;
  };
  /** Union: choose an alternative, then edit the chosen one in place. */
  const unionControl = (options: Schema[]): React.ReactNode => {
    const optionLabels = options.map(choiceLabel).map((text, index, all) => all.indexOf(text) === index ? text : `${text} ${index + 1}`);
    const implicit = options.findIndex(choice => matchesChoice(choice, current));
    const selected = chosen !== undefined && chosen < options.length ? chosen : implicit;
    const branch = selected >= 0 ? options[selected] : undefined;
    return <>
      <select id={id} aria-label={label} disabled={disabled} value={String(selected)} onChange={event => {
        const index = Number(event.target.value);
        const option = options[index];
        if (option === undefined) return;
        setChosen(index);
        if (option.const !== undefined) change(path, option.const);
        else if (Array.isArray(option.enum)) { if (option.enum.length) change(path, option.enum[0]); }
        else if (!matchesChoice(option, current)) change(path, seedChoice(option, schema.default));
      }}>
        <option value="-1" disabled>{current === undefined ? labels.unset : JSON.stringify(current)}</option>
        {options.map((_, index) => <option key={index} value={index}>{optionLabels[index]}</option>)}
      </select>
      {branch === undefined || branch.const !== undefined || Array.isArray(branch.enum) ? null
        : <Field bare schema={branch} root={root} path={path} labelPath={[...keys, 'value']} base={base} override={override} change={change} labels={labels} entryId={entryId} depth={depth + 1} locked={disabled} />}
    </>;
  };
  /** Array: one row per item; scalar items edit inline, nested items expand into their own form. */
  const listControl = (itemSchema: Schema): React.ReactNode => {
    const entries = Array.isArray(current) ? current : [];
    const write = (next: unknown[]): void => change(path, next);
    const edit = (index: number) => (itemPath: string[], next: unknown, resetLeaf?: boolean): void => {
      const source = entries[index];
      const edited = itemPath.length ? update(isObject(source) ? source : {}, itemPath, next, resetLeaf) : next;
      write(entries.map((value, at) => at === index ? edited : value));
    };
    const typed = scalarType(itemSchema, root) === 'string';
    const commit = (): void => { const text = draft.trim(); if (!text) return; write([...entries, text]); setDraft(''); };
    return <div className="studio-config-list">
      {entries.map((value, index) => <div className="studio-list-row" key={index}>
        <Field bare schema={itemSchema} root={root} path={[]} labelPath={[...keys, String(index)]} base={value} override={value} change={edit(index)} labels={labels} entryId={entryId} depth={depth + 1} locked={disabled} />
        <Button small disabled={disabled} aria-label={`${labels.items.remove}: ${label}[${index}]`} onClick={() => write(entries.filter((_, at) => at !== index))}>{labels.items.remove}</Button>
      </div>)}
      <div className="studio-list-row">
        {typed
          ? <input id={id} aria-label={`${labels.items.draft}: ${label}`} placeholder={labels.items.draft} disabled={disabled} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
          : <span id={id} className="studio-muted studio-hint">{choiceLabel(itemSchema)}</span>}
        <Button small disabled={disabled || (typed && !draft.trim())} aria-label={`${labels.items.add}: ${label}`} onClick={() => typed ? commit() : write([...entries, emptyValue(itemSchema, root)])}>{labels.items.add}</Button>
      </div>
    </div>;
  };
  /** Dictionary: fixed schema per key, so the key is shown and its value edited in place. */
  const dictControl = (valueSchema: Schema): React.ReactNode => {
    const entries = isObject(current) ? current : {};
    const write = (next: Record<string, unknown>): void => change(path, next);
    const edit = (key: string) => (valuePath: string[], next: unknown, resetLeaf?: boolean): void => {
      const source = entries[key];
      const edited = valuePath.length ? update(isObject(source) ? source : {}, valuePath, next, resetLeaf) : next;
      write({ ...entries, [key]: edited });
    };
    const commit = (): void => { const key = draft.trim(); if (!key || own(entries, key)) return; write({ ...entries, [key]: emptyValue(valueSchema, root) }); setDraft(''); };
    return <div className="studio-config-list">
      {Object.entries(entries).map(([key, value]) => <div className="studio-list-row" key={key}>
        <span className="studio-mono studio-config-key">{key}</span>
        <Field bare schema={valueSchema} root={root} path={[]} labelPath={[...keys, key]} base={value} override={value} change={edit(key)} labels={labels} entryId={entryId} depth={depth + 1} locked={disabled} />
        <Button small disabled={disabled} aria-label={`${labels.items.remove}: ${label}.${key}`} onClick={() => { const next = { ...entries }; delete next[key]; write(next); }}>{labels.items.remove}</Button>
      </div>)}
      <div className="studio-list-row">
        <input id={id} aria-label={`${labels.items.key}: ${label}`} placeholder={labels.items.key} disabled={disabled} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
        <Button small disabled={disabled || !draft.trim()} aria-label={`${labels.items.add}: ${label}`} onClick={commit}>{labels.items.add}</Button>
      </div>
    </div>;
  };
  let input: React.ReactNode;
  if (expression) input = <p role="status" aria-label={label}>{labels.unsupported}</p>;
  else if (union) input = unionControl(union);
  else if (values) input = dictControl(values);
  else if (items) input = listControl(items);
  else input = (depth > 16 ? undefined : scalarControl(schema, current, label, id, next => change(path, next))) ?? <p role="status" aria-label={label}>{labels.unsupported}</p>;
  if (bare) return input;
  return <div className="studio-field studio-config-field" data-overridden={overridden}>
    <div className="studio-field-head"><label htmlFor={id} className="studio-mono">{typeof schema.title === 'string' ? schema.title : keys[keys.length - 1] ?? labels.json}</label><span className="studio-config-state">{overridden ? labels.overridden : labels.inherited}</span>{reset}</div>
    {typeof schema.description === 'string' && <span className="studio-muted studio-hint">{schema.description}</span>}
    {input}
  </div>;
}

function comparisonBase(raw: Schema | undefined, root: Schema | undefined, base: unknown, depth = 0): unknown {
  if (!raw || !root || depth > 16) return base;
  let schema = resolve(raw, root);
  if (Array.isArray(schema.anyOf)) {
    const literal = schema.anyOf.filter(branch => !isObject(branch) || branch.$ref !== '#/$defs/loaderExpression');
    if (literal.length === 1 && literal.length < schema.anyOf.length && isObject(literal[0])) schema = resolve(literal[0], root);
  }
  const value = base === undefined ? schema.default : base;
  if (isObject(schema.properties) && (value === undefined || isObject(value))) {
    return { ...(isObject(value) ? value : {}), ...Object.fromEntries(Object.entries(schema.properties).filter(([, child]) => isObject(child)).map(([key, child]) => [key, comparisonBase(child as Schema, root, isObject(value) ? value[key] : undefined, depth + 1)])) };
  }
  return value;
}

/** Config selection is key presence; an empty override intentionally keeps a Config selected. */
export function ConfigEditor({ entries, value, onChange, locale }: ConfigEditorProps) {
  const labels = copy[locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en'];
  const items: PickerItem[] = [
    ...entries.map(entry => ({ name: entry.id, title: pluginTitle(entry.name, locale), subtitle: pluginTitle(entry.name, locale) === entry.name ? entry.id : `${entry.id} · ${entry.name}`, description: pluginPurpose(entry.name, locale), searchText: `${entry.name} ${pluginTitle(entry.name, locale)} ${JSON.stringify(entry.schema ?? {})}`,
      // Without a schema there is no form: a value Studio set stays on and locked, since turning it
      // off would drop it with no way back except restoring the preset defaults.
      ...(isDelegationPlugin(entry.name) ? { disabledReason: labels.delegated } : entry.error || !entry.schema ? own(value, entry.id) ? { lockedReason: labels.fixed } : { disabledReason: entry.error || labels.unavailable } : {}) })),
    ...Object.keys(value).filter(id => !entries.some(entry => entry.id === id)).map(id => ({ name: id, title: id, description: labels.unavailable })),
  ];
  const selected = items.filter(item => own(value, item.name)).map(item => item.name);
  const change = (names: string[]) => onChange(Object.fromEntries([
    ...Object.entries(value).filter(([id]) => names.includes(id)),
    ...names.filter(id => !own(value, id)).map(id => [id, {}]),
  ]));
  return <div className="studio-stack">
    <ItemPicker label={labels.list} items={items} selected={selected} onChange={change} labels={labels.picker} filters={['all', 'modified']}
      hasDetails={id => entries.some(entry => entry.id === id && entry.schema && !entry.error)}
      isModified={id => { const entry = entries.find(item => item.id === id); return !!entry && own(value, id) && hasChangedOverride(comparisonBase(entry.schema, entry.schema, entry.config), value[id]); }}
      renderDetails={id => { const entry = entries.find(item => item.id === id); return entry?.schema && own(value, id) ? <Field schema={entry.schema} root={entry.schema} path={[]} base={entry.config} override={value[id]!} entryId={id} labels={labels} change={(path, next, reset) => onChange({ ...value, [id]: update(value[id]!, path, next, reset) })} /> : null; }} />
  </div>;
}
