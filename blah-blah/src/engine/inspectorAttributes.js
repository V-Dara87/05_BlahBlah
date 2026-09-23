/**
 * Odin-Inspector-style *attributes* for schema-driven inspector fields.
 *
 * A prop definition already describes a field's type and value
 * (`{ type: 'number', default: 1, min: 0, max: 10 }`); an attribute describes
 * how the field is laid out and when it applies. They live in the same object,
 * so declaring one looks like this:
 *
 *   static props = {
 *     enabled:   { type: 'boolean', default: true, controls: 'Motion' },
 *     amplitude: { type: 'number', default: 20, box: 'Motion', showIf: 'enabled' },
 *     curve:     { type: 'select', options: ['linear', 'ease'], selectButton: true },
 *     bake:      { type: 'button', label: 'Bake Curves', action: 'bake' },
 *   };
 *
 * Everything here is pure and React-free: schema → normalised attributes,
 * condition expressions → booleans, and fields → the tabs / groups / rows the
 * inspector actually paints. InspectorField.jsx owns the DOM; this module owns
 * the decisions, which is also what makes them testable without a browser.
 *
 * ─── Attribute reference ────────────────────────────────────────────────────
 *
 * Grouping (same attribute name = same group; groups render where their first
 * member was declared, so members do not have to be adjacent):
 *   box: 'Name'        a titled box around its members              [BoxGroup]
 *   foldout: 'Name'    same, but collapsible (open by default)        [FoldoutGroup]
 *   tab: 'Name'        a tab; tabs are the outermost grouping        [TabGroup]
 *   inline: true       share the row with the inline fields before/after it
 *                                                                    [HorizontalGroup]
 *   title: 'Heading'   a heading row rendered above this field       [Title]
 *   space: true | 12   vertical space before this field              [PropertySpace]
 *
 * Conditions (evaluated against the values of the other props in the same
 * schema, so `showIf: 'enabled && speed > 2'` just works):
 *   showIf, hideIf, enableIf, disableIf                              [ShowIf / HideIf]
 *
 * Controls:
 *   toggleLeft: true   checkbox first, label after it                [ToggleLeft]
 *   selectButton: true render a `select` as a strip of buttons      [EnumToggleButtons]
 *   controls: 'Name'   a boolean that enables the group named `Name` [ToggleGroup]
 *   button: {...}      an action button next to the field            [Button]
 *
 * And `type: 'button'` is a whole field that is an action button.
 */

/** Every attribute key `parseFieldAttributes` understands, plus its aliases. */
const STRING_ATTRIBUTES = {
  box: 'box',
  boxGroup: 'box',
  foldout: 'foldout',
  foldoutGroup: 'foldout',
  tab: 'tab',
  tabGroup: 'tab',
  title: 'title',
};

const CONDITION_ATTRIBUTES = {
  showIf: 'showIf',
  hideIf: 'hideIf',
  enableIf: 'enableIf',
  disableIf: 'disableIf',
};

const FLAG_ATTRIBUTES = {
  inline: 'inline',
  horizontal: 'inline',
  toggleLeft: 'toggleLeft',
  selectButton: 'selectButton',
  enumButtons: 'selectButton',
};

/** Attribute keys written onto the field objects the inspector renders. */
export const FIELD_ATTRIBUTE_KEYS = [
  ...new Set([
    ...Object.values(STRING_ATTRIBUTES),
    ...Object.values(CONDITION_ATTRIBUTES),
    ...Object.values(FLAG_ATTRIBUTES),
    'space',
    'controls',
    'button',
  ]),
];

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Pull the attribute half out of one prop definition.
 *
 * Only known attributes that are actually present are copied, so an
 * attribute-free field keeps producing exactly the object it produced before
 * attributes existed (and the inspector stays on its plain single-row path).
 *
 * @param {object} def - a `static props` entry (already known to be an object)
 * @returns {object} attribute key/value pairs, possibly empty
 */
export function parseFieldAttributes(def) {
  const attributes = {};
  if (!isPlainObject(def)) return attributes;

  for (const [key, attribute] of Object.entries(STRING_ATTRIBUTES)) {
    if (typeof def[key] === 'string' && def[key].trim()) {
      attributes[attribute] = def[key].trim();
    }
  }
  for (const [key, attribute] of Object.entries(CONDITION_ATTRIBUTES)) {
    if (typeof def[key] === 'string' && def[key].trim()) {
      attributes[attribute] = def[key].trim();
    } else if (typeof def[key] === 'function') {
      // A function condition is legal too: it receives the values map.
      attributes[attribute] = def[key];
    }
  }
  for (const [key, attribute] of Object.entries(FLAG_ATTRIBUTES)) {
    if (def[key] === true) attributes[attribute] = true;
  }

  // `space: true` means "a normal gap", a number means "that many pixels".
  if (def.space === true) attributes.space = 6;
  else if (typeof def.space === 'number' && def.space > 0) attributes.space = def.space;

  // A boolean field can own the group it `controls` (Odin's ToggleGroup).
  if (typeof def.controls === 'string' && def.controls.trim()) {
    attributes.controls = def.controls.trim();
  } else if (typeof def.toggleGroup === 'string' && def.toggleGroup.trim()) {
    attributes.controls = def.toggleGroup.trim();
  } else if (typeof def.group === 'string' && def.group.trim()) {
    attributes.controls = def.group.trim();
  }

  // `button: 'method'` and `button: { label, action }` are both accepted.
  if (typeof def.button === 'string' && def.button.trim()) {
    attributes.button = { label: def.button.trim(), action: def.button.trim() };
  } else if (isPlainObject(def.button) && typeof def.button.action === 'string') {
    attributes.button = {
      label: def.button.label || def.button.action,
      action: def.button.action,
      variant: def.button.variant,
    };
  }

  return attributes;
}

/**
 * Build the subfield schema for a `struct` / `struct[]` field's `fields` map.
 *
 * Struct subfields are described with the same syntax as top-level props
 * (including attributes), so they get the same normalisation — which is what
 * lets a nested struct carry its own `showIf`, `toggleLeft` or inline row.
 */
export function subfieldSchema(fields) {
  if (!isPlainObject(fields)) return [];
  return Object.entries(fields).map(([name, def]) => {
    if (isPlainObject(def)) {
      return {
        name,
        label: def.label || name,
        type: def.type || inferType(def.default),
        defaultVal: def.default ?? (def.type === 'boolean' ? false : def.type === 'number' ? 0 : ''),
        min: def.min,
        max: def.max,
        step: def.step,
        options: def.options,
        fields: def.fields,
        ...parseFieldAttributes(def),
      };
    }
    return { name, label: name, type: inferType(def), defaultVal: def };
  });
}

function inferType(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return 'color';
  return 'string';
}

// ─── Conditions ─────────────────────────────────────────────────────────────

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'await',
]);

const conditionCache = new Map();
const warnedConditions = new Set();

/**
 * Compile `expression` into a function of the schema's own prop names, so a
 * condition reads like ordinary script code (`"enabled && speed > 2"`) instead
 * of indexing into a values object.
 *
 * Compilation is deliberately forgiving: a condition that does not compile, or
 * that names a prop that is not in the schema, disables the condition rather
 * than hiding the field. A half-written condition should never make fields
 * disappear with no way back.
 */
function compileCondition(expression, values) {
  if (typeof expression === 'function') return expression;
  if (typeof expression !== 'string') return null;

  const names = Object.keys(values || {}).filter(
    (name) => IDENTIFIER.test(name) && !RESERVED.has(name),
  );
  const cacheKey = `${expression}\u0000${names.join(',')}`;
  const cached = conditionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let fn = null;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(...names, `"use strict"; return (${expression});`);
  } catch (err) {
    if (!warnedConditions.has(expression)) {
      warnedConditions.add(expression);
      console.warn(`Inspector attribute: could not compile condition "${expression}"`, err);
    }
  }
  conditionCache.set(cacheKey, fn);
  return fn;
}

/**
 * Evaluate one condition expression against a field's sibling values.
 *
 * @param {string|Function} expression
 * @param {object} values - the values map the field's schema is rendered with
 * @returns {boolean|undefined} undefined when the condition cannot be evaluated
 */
export function evaluateCondition(expression, values = {}) {
  const fn = compileCondition(expression, values);
  if (!fn) return undefined;

  try {
    if (typeof expression === 'function') return !!expression(values);
    const names = Object.keys(values || {}).filter(
      (name) => IDENTIFIER.test(name) && !RESERVED.has(name),
    );
    return !!fn(...names.map((name) => values[name]));
  } catch {
    // Referencing something that does not exist yet (a prop being typed, a
    // stale saved layout) must not blank the field out.
    return undefined;
  }
}

/** `showIf` / `hideIf` — is this field shown at all? */
export function isFieldVisible(field, values = {}) {
  if (!field) return false;
  if (field.showIf !== undefined) {
    const shown = evaluateCondition(field.showIf, values);
    if (shown === false) return false;
  }
  if (field.hideIf !== undefined) {
    const hidden = evaluateCondition(field.hideIf, values);
    if (hidden === true) return false;
  }
  return true;
}

/** `enableIf` / `disableIf` — shown, but editable? */
export function isFieldEnabled(field, values = {}) {
  if (!field) return false;
  if (field.enableIf !== undefined && evaluateCondition(field.enableIf, values) === false) {
    return false;
  }
  if (field.disableIf !== undefined && evaluateCondition(field.disableIf, values) === true) {
    return false;
  }
  return true;
}

// ─── Layout ─────────────────────────────────────────────────────────────────

/** Field types that own the whole row instead of sitting in the label column. */
export const FULL_WIDTH_TYPES = new Set([
  'struct',
  'struct[]',
  'button',
  'array',
  'string[]',
  'number[]',
  'color[]',
  'boolean[]',
  'select[]',
  'asset[]',
  'entity[]',
]);

export function isFullWidthType(type) {
  if (!type) return false;
  return FULL_WIDTH_TYPES.has(type) || type === 'array' || (typeof type === 'string' && type.endsWith('[]'));
}

/**
 * Group a schema into the tabs → groups → rows the inspector paints.
 *
 * - Fields are filtered by their `showIf` / `hideIf` first, so a tab that lost
 *   every field disappears with them ("a tab only exists if it has something in
 *   it").
 * - Within a tab, `box` / `foldout` members collect by name and render at the
 *   position of their first member, so members need not be adjacent.
 * - Ungrouped fields keep their order as "plain" sections.
 * - Runs of `inline` fields collapse into a single row.
 *
 * @returns {{ tabs: Array, isEmpty: boolean, visibleFields: Array }}
 */
export function buildInspectorLayout(fields, values = {}) {
  const visible = (fields || []).filter((field) => isFieldVisible(field, values));
  if (visible.length === 0) return { tabs: [], isEmpty: true, visibleFields: [] };

  const tabs = [];
  const tabIndex = new Map();

  const tabFor = (name) => {
    const key = name || '';
    if (!tabIndex.has(key)) {
      tabIndex.set(key, tabs.length);
      tabs.push({ name: key, sections: [], entries: [] });
    }
    return tabs[tabIndex.get(key)];
  };

  // Fields with no `tab` belong to an unnamed tab, which sorts first.
  if (visible.some((field) => !field.tab)) tabFor('');

  for (const field of visible) {
    const tab = tabFor(field.tab);

    // Grouped fields join their group where it was first declared.
    const groupKind = field.box ? 'box' : field.foldout ? 'foldout' : null;
    const groupName = field.box || field.foldout || null;
    let section = null;

    if (groupKind) {
      section = tab.sections.find((s) => s.kind === groupKind && s.name === groupName);
      if (!section) {
        section = { kind: groupKind, name: groupName, controller: null, entries: [] };
        tab.sections.push(section);
      }
    } else {
      // Un-grouped fields: extend the trailing plain section when there is one
      // so a run of them stays a run, instead of one section per field.
      const last = tab.sections[tab.sections.length - 1];
      if (last && last.kind === 'plain') section = last;
      else {
        section = { kind: 'plain', name: null, controller: null, entries: [] };
        tab.sections.push(section);
      }
    }

    appendFieldEntry(section, field);
  }

  // A boolean that declares `controls: 'Group'` becomes that group's switch.
  // Bound in a second pass: the controller may be declared before the group it
  // controls, and then the group does not exist yet on the first pass.
  for (const field of visible) {
    if (!field.controls || field.type !== 'boolean') continue;
    const tab = tabs[tabIndex.get(field.tab || '')];
    if (!tab) continue;
    const target = tab.sections.find((s) => s.name === field.controls && s.kind !== 'plain');
    if (target && !target.controller) {
      target.controller = { name: field.name, label: field.label || field.name };
    }
  }

  for (const tab of tabs) {
    tab.sections = tab.sections.filter((section) => section.entries.length > 0);
    for (const section of tab.sections) {
      for (const entry of section.entries) {
        if (entry.kind === 'row') entry.enabled = entry.fields.every((f) => isFieldEnabled(f, values));
      }
    }
  }

  // "A tab only exists if it has something in it."
  const populated = tabs.filter((tab) => tab.sections.length > 0);
  return { tabs: populated, isEmpty: populated.length === 0, visibleFields: visible };
}

function appendFieldEntry(section, field) {
  const entries = section.entries;

  if (field.title) entries.push({ kind: 'title', key: `title:${field.name}`, label: field.title });
  if (field.space) entries.push({ kind: 'space', key: `space:${field.name}`, size: field.space });

  // Consecutive `inline` fields share one row.
  const last = entries[entries.length - 1];
  if (field.inline && last && last.kind === 'row' && last.inlineOpen) {
    last.fields.push(field);
    return;
  }
  if (field.inline) {
    entries.push({ kind: 'row', key: `row:${field.name}`, fields: [field], inlineOpen: true });
    return;
  }
  // A non-inline field closes the open inline run, so a later inline field
  // starts a fresh row instead of joining across it.
  if (last && last.kind === 'row') last.inlineOpen = false;
  entries.push({ kind: 'field', key: field.name, field });
}

/** The row label for an entry: an inline row is labelled by its first field. */
export function entryLabel(entry) {
  const field = entry.kind === 'row' ? entry.fields[0] : entry.field;
  return field?.label || field?.name || '';
}
