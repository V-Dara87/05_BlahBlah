/**
 * Fast "which script does this ScriptComponent point at" lookup.
 *
 * The renderer resolves this for every script component on every frame, and the
 * old code did a linear scripts.find() with four comparisons each time. The
 * scripts array is replaced (not mutated) on every edit, so an index built once
 * per array identity stays valid and costs nothing while playing.
 *
 * Resolution order is identical to the previous inline find():
 *   id === scriptId  ->  name === scriptName  ->  name === `${scriptName}.jsx`
 *   ->  id === `script-${scriptName}`
 * with the earliest script in the array winning inside each rule, and the
 * first rule that matches anything winning overall per script (find() returned
 * the first script matching ANY rule, so ties are resolved by array order; the
 * index below reproduces that by storing the lowest array position per key).
 */
const indexCache = new WeakMap();

function buildIndex(scripts) {
  const byId = new Map();
  const byName = new Map();
  scripts.forEach((s, i) => {
    if (!s) return;
    if (s.id !== undefined && !byId.has(s.id)) byId.set(s.id, i);
    if (s.name !== undefined && !byName.has(s.name)) byName.set(s.name, i);
  });
  return { byId, byName };
}

export function findScriptDef(scripts, comp) {
  if (!Array.isArray(scripts) || !comp) return undefined;
  let index = indexCache.get(scripts);
  if (!index) {
    index = buildIndex(scripts);
    indexCache.set(scripts, index);
  }
  const { byId, byName } = index;
  const name = comp.scriptName;
  let best = Infinity;
  const consider = (i) => {
    if (i !== undefined && i < best) best = i;
  };
  consider(byId.get(comp.scriptId));
  if (name !== undefined && name !== null) {
    consider(byName.get(name));
    consider(byName.get(`${name}.jsx`));
    consider(byId.get(`script-${name}`));
  }
  return best === Infinity ? undefined : scripts[best];
}