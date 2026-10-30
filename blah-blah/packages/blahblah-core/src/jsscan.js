// Small, dependency-free helpers for reading JavaScript source text.
// They are used as a fallback when esbuild is not available, and to read a
// script's `static props = { ... }` declaration WITHOUT executing the script.

/** 1-based line/column of a character index. */
export function positionOf(code, index) {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < index && i < code.length; i++) {
    if (code[i] === '\n') {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: index - lastBreak };
}

/**
 * If a string, template literal or comment starts at `i`, returns the index
 * just after it. Otherwise returns `i` unchanged. A quote that is never closed
 * on the same line is NOT treated as a string (so an apostrophe in JSX text
 * such as `<p>Don't</p>` does not swallow the rest of the file).
 */
export function skipNonCode(code, i) {
  const c = code[i];
  const next = code[i + 1];

  if (c === '/' && next === '/') {
    let j = i + 2;
    while (j < code.length && code[j] !== '\n') j++;
    return j;
  }
  if (c === '/' && next === '*') {
    const end = code.indexOf('*/', i + 2);
    return end === -1 ? code.length : end + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < code.length) {
      const ch = code[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === c) return j + 1;
      if (ch === '\n') return i; // not a real string
      j++;
    }
    return i;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < code.length) {
      const ch = code[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') return j + 1;
      if (ch === '$' && code[j + 1] === '{') {
        const close = findMatchingBracket(code, j + 1);
        if (close === -1) return code.length;
        j = close + 1;
        continue;
      }
      j++;
    }
    return code.length;
  }
  return i;
}

const OPEN = '([{';
const CLOSE = ')]}';

/** Index of the bracket that closes the one at `openIdx`, or -1. */
export function findMatchingBracket(code, openIdx) {
  const stack = [];
  let i = openIdx;
  while (i < code.length) {
    const skipped = skipNonCode(code, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = code[i];
    if (OPEN.includes(c)) {
      stack.push(c);
    } else if (CLOSE.includes(c)) {
      const expected = OPEN[CLOSE.indexOf(c)];
      if (stack.pop() !== expected) return -1;
      if (stack.length === 0) return i;
    }
    i++;
  }
  return -1;
}

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);

function lastWordBefore(code, index) {
  let j = index - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  const end = j + 1;
  while (j >= 0 && /[\w$]/.test(code[j])) j--;
  return code.slice(j + 1, end);
}

const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '~', '^']);

/**
 * Checks that (), [] and {} are balanced, ignoring brackets inside strings,
 * template literals, comments and regex literals. Returns diagnostics with
 * line/column.
 */
export function scanBrackets(code) {
  const diagnostics = [];
  const stack = []; // { ch, index } for brackets, { ch: '${', index } for template holes
  let prev = '';
  let i = 0;

  const readTemplate = (j) => {
    while (j < code.length) {
      const ch = code[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') return j + 1;
      if (ch === '$' && code[j + 1] === '{') {
        stack.push({ ch: '${', index: j });
        return j + 2;
      }
      j++;
    }
    diagnostics.push({ severity: 'error', ...positionOf(code, code.length), message: 'Unterminated template literal.' });
    return code.length;
  };

  while (i < code.length) {
    const c = code[i];

    if (c === '`') {
      i = readTemplate(i + 1);
      prev = '`';
      continue;
    }

    const skipped = skipNonCode(code, i);
    if (skipped !== i) {
      if (code[i] === '/' && code[i + 1] === '*' && code.indexOf('*/', i + 2) === -1) {
        diagnostics.push({ severity: 'error', ...positionOf(code, i), message: 'Unterminated comment.' });
      }
      if (code[i] !== '/') prev = c; // a string counts as a value
      i = skipped;
      continue;
    }

    if (c === '/' && (REGEX_PRECEDERS.has(prev) || (/[\w$]/.test(prev) && REGEX_KEYWORDS.has(lastWordBefore(code, i))))) {
      // Possible regex literal: only treat it as one if it closes on this line.
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < code.length && code[j] !== '\n') {
        const ch = code[j];
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        i = j + 1;
        prev = '/';
        continue;
      }
    }

    if (OPEN.includes(c)) {
      stack.push({ ch: c, index: i });
    } else if (CLOSE.includes(c)) {
      const top = stack[stack.length - 1];
      if (c === '}' && top && top.ch === '${') {
        stack.pop();
        i = readTemplate(i + 1);
        prev = '`';
        continue;
      }
      const expected = OPEN[CLOSE.indexOf(c)];
      if (!top || top.ch !== expected) {
        diagnostics.push({
          severity: 'error',
          ...positionOf(code, i),
          message: top
            ? `Unexpected "${c}" (the innermost open bracket is "${top.ch}" from line ${positionOf(code, top.index).line}).`
            : `Unexpected "${c}" with no matching opening bracket.`,
        });
      } else {
        stack.pop();
      }
    }

    if (!/\s/.test(c)) prev = c;
    i++;
  }

  for (const open of stack) {
    diagnostics.push({
      severity: 'error',
      ...positionOf(code, open.index),
      message: open.ch === '${' ? 'Unclosed "${" in template literal.' : `Unclosed "${open.ch}".`,
    });
  }

  return diagnostics;
}

export const UNSUPPORTED = Symbol('unsupported');

/**
 * Reads a JavaScript object/array/primitive LITERAL as data, never executing
 * it. Anything that is not a plain literal (function calls, identifiers,
 * spreads, arithmetic) becomes UNSUPPORTED and `partial` is set to true.
 */
export function parseLiteral(src) {
  let i = 0;
  let partial = false;
  const n = src.length;

  const ws = () => {
    while (i < n) {
      if (/\s/.test(src[i])) i++;
      else if (src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
        const j = skipNonCode(src, i);
        i = j === i ? i + 1 : j;
      } else break;
    }
  };

  const skipExpression = () => {
    let depth = 0;
    while (i < n) {
      const j = skipNonCode(src, i);
      if (j !== i) {
        i = j;
        continue;
      }
      const c = src[i];
      if (OPEN.includes(c)) depth++;
      else if (CLOSE.includes(c)) {
        if (depth === 0) return;
        depth--;
      } else if (c === ',' && depth === 0) return;
      i++;
    }
  };

  const endsValue = () => {
    const save = i;
    ws();
    const ok = i >= n || src[i] === ',' || src[i] === '}' || src[i] === ']' || src[i] === ')';
    i = save;
    return ok;
  };

  const readString = () => {
    const quote = src[i];
    i++;
    let out = '';
    while (i < n && src[i] !== quote) {
      if (src[i] === '\\') {
        const e = src[i + 1];
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        out += map[e] !== undefined ? map[e] : e;
        i += 2;
        continue;
      }
      out += src[i++];
    }
    i++; // closing quote
    return out;
  };

  const unsupported = () => {
    partial = true;
    skipExpression();
    return UNSUPPORTED;
  };

  const evaluatePropHelper = (helperName, args) => {
    switch (helperName) {
      case 'num': {
        const def = typeof args[0] === 'number' ? args[0] : 0;
        const opts = args[1] && typeof args[1] === 'object' && args[1] !== UNSUPPORTED ? args[1] : {};
        return { type: 'number', default: def, ...opts };
      }
      case 'bool': {
        const def = typeof args[0] === 'boolean' ? args[0] : Boolean(args[0]);
        const opts = args[1] && typeof args[1] === 'object' && args[1] !== UNSUPPORTED ? args[1] : {};
        return { type: 'boolean', default: def, ...opts };
      }
      case 'color': {
        const def = typeof args[0] === 'string' && args[0] ? args[0] : '#ffffff';
        const opts = args[1] && typeof args[1] === 'object' && args[1] !== UNSUPPORTED ? args[1] : {};
        return { type: 'color', default: def, ...opts };
      }
      case 'text': {
        const def = typeof args[0] === 'string' ? args[0] : '';
        const opts = args[1] && typeof args[1] === 'object' && args[1] !== UNSUPPORTED ? args[1] : {};
        return { type: 'string', default: def, ...opts };
      }
      case 'select': {
        const optsArr = Array.isArray(args[1]) ? args[1] : [];
        const def = args[0] !== undefined && args[0] !== UNSUPPORTED ? args[0] : optsArr[0];
        const opts = args[2] && typeof args[2] === 'object' && args[2] !== UNSUPPORTED ? args[2] : {};
        return { type: 'select', default: def, options: optsArr, ...opts };
      }
      case 'asset': {
        const valid = ['video', 'audio', 'image'];
        const assetType = typeof args[0] === 'string' && valid.includes(args[0]) ? args[0] : 'video';
        const opts = args[1] && typeof args[1] === 'object' && args[1] !== UNSUPPORTED ? args[1] : {};
        return { type: 'asset', assetType, default: null, ...opts };
      }
      case 'entity': {
        const opts = args[0] && typeof args[0] === 'object' && args[0] !== UNSUPPORTED ? args[0] : {};
        return { type: 'entity', default: null, ...opts };
      }
      case 'font': {
        const def = typeof args[0] === 'string' && args[0] ? args[0] : 'Inter';
        const opts = args[1] && typeof args[1] === 'object' && args[1] !== UNSUPPORTED ? args[1] : {};
        return { type: 'font', default: def, ...opts };
      }
      case 'button': {
        const opts = args[1] && typeof args[1] === 'object' && args[1] !== UNSUPPORTED ? args[1] : {};
        return { type: 'button', ...opts };
      }
      default:
        return unsupported();
    }
  };

  const readValue = () => {
    ws();
    const c = src[i];
    if (c === '{') return readObject();
    if (c === '[') return readArray();
    if (c === '"' || c === "'") {
      const v = readString();
      return endsValue() ? v : unsupported();
    }
    if (c === '`') {
      const end = skipNonCode(src, i);
      const raw = src.slice(i + 1, end - 1);
      if (end !== i && !raw.includes('${')) {
        i = end;
        return raw;
      }
      return unsupported();
    }

    const rest = src.slice(i);
    const helperMatch = /^(num|bool|color|text|select|asset|entity|font|button)\s*\(/.exec(rest);
    if (helperMatch) {
      const helperName = helperMatch[1];
      i += helperMatch[0].length;
      const args = [];
      while (i < n) {
        ws();
        if (src[i] === ')') {
          i++;
          break;
        }
        const before = i;
        const argVal = readValue();
        args.push(argVal);
        ws();
        if (src[i] === ',') {
          i++;
        } else if (src[i] === ')') {
          i++;
          break;
        } else if (i === before) {
          skipExpression();
          if (src[i] === ',') i++;
        }
      }
      const evaluated = evaluatePropHelper(helperName, args);
      return endsValue() ? evaluated : unsupported();
    }

    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      const start = i;
      i += num[0].length;
      if (endsValue()) return Number(num[0]);
      i = start;
      return unsupported();
    }
    const word = /^(true|false|null|undefined|Infinity|-Infinity)\b/.exec(rest);
    if (word) {
      const start = i;
      i += word[0].length;
      if (endsValue()) {
        return { true: true, false: false, null: null, undefined: undefined, Infinity, '-Infinity': -Infinity }[word[1]];
      }
      i = start;
    }
    return unsupported();
  };

  const readArray = () => {
    i++; // [
    const out = [];
    while (i < n) {
      ws();
      if (src[i] === ']') {
        i++;
        break;
      }
      const before = i;
      out.push(readValue());
      ws();
      if (src[i] === ',') i++;
      else if (src[i] !== ']' && i === before) i++;
    }
    return out;
  };

  const readObject = () => {
    i++; // {
    const out = {};
    while (i < n) {
      ws();
      if (src[i] === '}') {
        i++;
        break;
      }
      const before = i;
      let key = null;
      if (src[i] === '"' || src[i] === "'") key = readString();
      else {
        const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(src.slice(i));
        if (m) {
          key = m[0];
          i += m[0].length;
        }
      }
      ws();
      if (key !== null && src[i] === ':') {
        i++;
        out[key] = readValue();
      } else {
        // spread, shorthand property, method, computed key...
        partial = true;
        skipExpression();
      }
      ws();
      if (src[i] === ',') i++;
      else if (src[i] !== '}' && i === before) i++;
    }
    return out;
  };

  const value = readValue();
  return { value, partial };
}
