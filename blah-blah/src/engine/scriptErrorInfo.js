/**
 * scriptErrorInfo.js — turn a raw script error string into something a
 * non-engineer can act on.
 *
 * The compiler / runtime produce developer-oriented text:
 *
 *   error[E001]: Unexpected "}"
 *    --> Arrow.jsx:12:5
 *    ...
 *
 * This module is pure (no DOM, no engine imports) so it is trivially testable
 * and safe to use from the Console, the Inspector, the script editor and the
 * toast alike. It answers four questions about an error message:
 *
 *   - parseErrorBlocks     → what are the individual errors?
 *   - explainErrorText     → what does the most common one mean, in plain words?
 *   - summarizeScriptError → a one-line summary + hint + location for badges
 *   - errorLinesForScript  → which lines of THIS script are at fault?
 */
 
// ─── plain-language hints ────────────────────────────────────────────────────
//
// Ordered: the first matching rule wins, so the more specific patterns come
// first. `hint` is a function of the regex match so it can quote the name.
const HINT_RULES = [
  {
    re: /Script paused/i,
    hint: () => 'The script was taking too long, often an endless loop. Fix the code, then press Re-enable.',
  },
  {
    re: /Unexpected end of file|Expected "[})\]]" but found end of file|Unterminated (template|regular expression)/i,
    hint: () => 'A bracket or quote was opened but never closed. Check that every ( { [ has a matching closing one.',
  },
  {
    re: /Unterminated string|Unterminated string literal/i,
    hint: () => 'A text string is missing its closing quote.',
  },
  {
    re: /Unexpected closing "([^"]+)" tag does not match opening "([^"]+)" tag|Expected closing "([^"]+)" tag to match opening "([^"]+)" tag|Unterminated JSX|Expected corresponding JSX closing tag/i,
    hint: () => 'A JSX tag (like <div>) is not closed, or its closing tag does not match the opening one.',
  },
  {
    re: /The character "([<>{}])" is not valid inside a JSX element/i,
    hint: (m) => `To show the character ${m[1]} as text inside JSX, write {'${m[1]}'} instead.`,
  },
  {
    re: /Unexpected "[})\]]"/i,
    hint: () => 'There is an extra or misplaced closing bracket near this line. Look for a ( { [ that was closed twice.',
  },
  {
    re: /Could not resolve "([^"]+)"|Cannot find module '?"?([^'"\s]+)|Failed to resolve (?:module|import)|No matching export in "[^"]*" for import "([^"]+)"/i,
    hint: (m) => {
      const name = m[1] || m[2] || m[3];
      return name
        ? `The import "${name}" could not be found. Check the spelling, or add the package in the Package Manager.`
        : 'An import could not be found. Check the spelling, or add the package in the Package Manager.';
    },
  },
  {
    re: /(?:The symbol|Identifier) "?'?([A-Za-z_$][\w$]*)"?'? has already been declared/i,
    hint: (m) => `"${m[1]}" is defined twice. Rename or remove one of them.`,
  },
  {
    re: /Cannot assign to "?([A-Za-z_$][\w$]*)"? because it is a constant|Assignment to constant variable|Invalid assignment to const/i,
    hint: () => 'A const value cannot be changed after it is created. Declare it with let instead.',
  },
  {
    re: /([A-Za-z_$][\w$.]*) is not defined/i,
    hint: (m) => `"${m[1]}" is used but was never created. Check the spelling, or define / import it first.`,
  },
  {
    re: /Cannot access '?([A-Za-z_$][\w$]*)'? before initialization/i,
    hint: (m) => `"${m[1]}" is used before the line that creates it. Move it below its definition.`,
  },
  {
    re: /Cannot (?:read|set) propert(?:y|ies) of (?:undefined|null)(?: \((?:reading|setting) '([^']+)'\))?/i,
    hint: (m) => m[1]
      ? `Something is empty (undefined) when the script tried to use ".${m[1]}". Check that the value exists first.`
      : 'Something is empty (undefined) when the script tried to use it. Check that the value exists first.',
  },
  {
    re: /([A-Za-z_$][\w$.]*) is not a function/i,
    hint: (m) => `"${m[1]}" is called like a function but is not one. Check the spelling, or what it was set to.`,
  },
  {
    re: /([A-Za-z_$][\w$.]*) is not a constructor/i,
    hint: (m) => `"${m[1]}" cannot be used with "new". Check the spelling or the import.`,
  },
  {
    re: /Expected ";" but found|Expected "[^"]+" but found|Unexpected "[^"]+"|Unexpected token|Unexpected identifier|Expected identifier/i,
    hint: () => 'Something is out of place here. A missing comma, bracket or quote on this line or the one before is the usual cause.',
  },
  {
    re: /Maximum call stack size exceeded/i,
    hint: () => 'A function keeps calling itself without stopping.',
  },
  {
    re: /Invalid array length/i,
    hint: () => 'An array was given a negative or enormous size. Check the number used.',
  },
];
 
/**
 * One-line, plain-language explanation of an error, or null when the error is
 * not one of the common ones. Accepts the bare error text ("Unexpected "}"")
 * or a whole formatted message — only the first error is considered.
 */
export function explainErrorText(text) {
  const source = String(text || '');
  if (!source) return null;
  for (const rule of HINT_RULES) {
    const m = rule.re.exec(source);
    if (m) return rule.hint(m);
  }
  return null;
}
 
// ─── parsing ─────────────────────────────────────────────────────────────────
 
const COMPILE_HEAD_RE = /^error\[E\d+\]:\s*(.*)$/;
const LOCATION_RE = /^\s*-->\s*(.+?):(\d+):(\d+)\s*$/;
 
/**
 * Split a formatted error string into its individual errors:
 *   [{ text, file, line, column }]
 * `file/line/column` are null when the error has no `--> file:line:col` line.
 * A message that is not in the Rust-like format (a plain runtime error, a raw
 * stack) yields a single block whose text is the first line.
 */
export function parseErrorBlocks(message) {
  const lines = String(message || '').split('\n');
  const blocks = [];
  let current = null;
 
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
 
  for (const raw of lines) {
    const head = COMPILE_HEAD_RE.exec(raw);
    if (head) {
      flush();
      current = { text: head[1].trim(), file: null, line: null, column: null };
      continue;
    }
    const loc = LOCATION_RE.exec(raw);
    if (loc) {
      if (!current) current = { text: '', file: null, line: null, column: null };
      if (current.line === null) {
        current.file = loc[1];
        current.line = Number(loc[2]);
        current.column = Number(loc[3]);
      }
    }
  }
  flush();
 
  if (blocks.length === 0) {
    // Not the structured format: use the first non-empty line as the text.
    const first = lines.find((l) => l.trim()) || '';
    return [{ text: first.trim(), file: null, line: null, column: null }];
  }
  // A runtime error has its header on the first line (no `error[E…]` prefix),
  // with the location below it — recover that header.
  if (blocks.length === 1 && !blocks[0].text) {
    const first = lines.find((l) => l.trim()) || '';
    blocks[0].text = first.trim();
  }
  return blocks;
}
 
/** Number of distinct errors in a formatted message (at least 1). */
export function countScriptErrors(message) {
  const matches = String(message || '').match(/error\[E\d+\]/g);
  return matches ? matches.length : 1;
}
 
const MAX_HEADLINE = 90;
 
function shorten(text, max = MAX_HEADLINE) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
 
/**
 * Everything a compact UI needs about an error:
 *   { headline, hint, location, count, line }
 *
 * headline — the first error's text, shortened to one line
 * hint     — plain-language explanation, or null
 * location — "Arrow.jsx:12:5" for the first error, or null
 * count    — how many errors the message holds
 * line     — 1-based line of the first error, or null
 */
export function summarizeScriptError(message) {
  const blocks = parseErrorBlocks(message);
  const first = blocks[0] || { text: '', file: null, line: null, column: null };
  const location = first.file ? `${first.file}:${first.line}:${first.column}` : null;
  return {
    headline: shorten(first.text) || 'Script error',
    hint: explainErrorText(first.text) || explainErrorText(message),
    location,
    count: countScriptErrors(message),
    line: first.line,
  };
}
 
// ─── editor line markers ─────────────────────────────────────────────────────
 
const basename = (p) => String(p || '').split(/[\\/]/).pop();
 
/**
 * Does an error located in `file` belong to the script called `scriptName`?
 * The bundler reports the entry file as "entry.jsx" and runtime source maps
 * report the script's own name; an error inside an imported file must not
 * mark a line in this script, because its line numbers refer to another file.
 */
function fileBelongsToScript(file, scriptName) {
  if (!file) return true;
  if (/node_modules|^https?:|^npm:/.test(file)) return false;
  const base = basename(file);
  if (base === 'entry.jsx' || base === '<stdin>' || base === 'stdin') return true;
  return base === basename(scriptName);
}
 
/**
 * Map of 1-based line number → array of error texts for the lines of a script
 * that a formatted error message points at. Used to paint the editor gutter.
 */
export function errorLinesForScript(message, scriptName) {
  const map = new Map();
  if (!message) return map;
  for (const block of parseErrorBlocks(message)) {
    if (block.line === null || !fileBelongsToScript(block.file, scriptName)) continue;
    const list = map.get(block.line) || [];
    list.push(block.text || 'Error');
    map.set(block.line, list);
  }
  return map;
}