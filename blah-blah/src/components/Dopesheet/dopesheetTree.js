/**
 * Dopesheet parameter list (plain, flat — no nesting):
 *
 *   ▼ Transform
 *       X · Y · Rotation · Scale X · Scale Y · Pivot X · Pivot Y · Opacity · Speed
 *   ▼ MyScript
 *       speed · amplitude · enabled · …
 *
 * Pure functions only (no React) so they can be unit-tested. Both the label
 * column and the lanes iterate the SAME `items`, which keeps every label row
 * vertically aligned with its lane.
 *
 * Item shape: { field, label } — `label` is the name shown inside the value cell.
 */

/** Same rule the Inspector uses for showing a keyframe diamond. */
export function isKeyframeableField(field) {
  const t = field?.type;
  if (!t) return false;
  if (t === 'entity' || t === 'asset' || t === 'struct' || t === 'struct[]'
    || t === 'array' || t === 'font' || t === 'button') return false;
  if (typeof t === 'string' && t.endsWith('[]')) return false;
  return true;
}

/**
 * Built-in Transform. TRANSFORM_FIELD_GROUPS describes Position / Rotation /
 * Scale / Pivot / Opacity / Speed; flattened, each field gets a plain label:
 * Position's are just the axis ("X", "Y"), Scale / Pivot / others are prefixed
 * ("Scale X", "Pivot Y"), and a lone field uses its group's name ("Rotation").
 */
export function buildTransformItems(transformGroups) {
  const items = [];
  for (const g of transformGroups) {
    const fields = g.fields.filter(isKeyframeableField);
    for (const field of fields) {
      let label;
      if (fields.length === 1) label = g.label;
      else if (g.label === 'Position') label = field.dragLabel || field.label || field.name;
      else label = `${g.label} ${field.dragLabel || field.label || field.name}`;
      items.push({ field, label });
    }
  }
  return items;
}

/** Any other component (script props, Camera, Shape, Text): one item per animatable field. */
export function buildFieldItems(fields) {
  return fields
    .filter(isKeyframeableField)
    .map((field) => ({ field, label: field.label || field.name }));
}