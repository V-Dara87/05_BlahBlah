/**
 * sourceMap.js — a tiny, dependency-free source-map v3 decoder.
 *
 * WHY THIS EXISTS: esbuild compiles every user script (JSX/TS stripped, npm
 * imports inlined) and we evaluate the result with `new Function(...)`. A
 * runtime error thrown by that evaluated code reports a line in the
 * GENERATED string, which is useless to a script author. esbuild gives us a
 * standard source map for that string; this module turns a generated
 * line:column back into the original script's line:column so the Console can
 * point at the exact line the user wrote.
 *
 * Only the pieces we need are implemented: decoding the VLQ `mappings` string
 * into per-generated-line segments, and the lookup for one position. No
 * `names` handling beyond passing the decoded name through, no indexed maps
 * (`sections`) — esbuild emits a flat map.
 *
 * Positions are 1-BASED in this module's public API (matching how editor and
 * compiler diagnostics read), even though the source-map spec is 0-based
 * internally.
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Map([...BASE64_CHARS].map((ch, i) => [ch, i]));

/**
 * Decode one VLQ-encoded segment (e.g. "AAgBC") into the signed integers it
 * carries. Standard base64 VLQ: 5 data bits per char, top bit (32) = more
 * chars follow, the low bit of the final value is the sign.
 */
function decodeVlq(segment) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (let i = 0; i < segment.length; i++) {
    const digit = BASE64_VALUES.get(segment[i]);
    if (digit === undefined) continue; // ignore padding/whitespace
    const continuation = digit & 32;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
    } else {
      const negative = value & 1;
      value >>>= 1;
      out.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/**
 * Decode a source map (JSON string or already-parsed object) into a form that
 * is cheap to query. The result:
 *
 *   { sources: string[], sourcesContent: string[], names: string[],
 *     lines: Array<Array<{ genCol, srcIdx, srcLine, srcCol, name }>> }
 *
 * `lines[generatedLine - 1]` holds that line's segments sorted by generated
 * column (esbuild guarantees that order). `genCol`/`srcLine`/`srcCol` are
 * 0-based (the spec's own encoding); `originalPosition` converts on the way
 * out. Returns null for input that isn't a usable map.
 */
export function decodeSourceMap(map) {
  let json = map;
  if (typeof map === 'string') {
    try {
      json = JSON.parse(map);
    } catch {
      return null;
    }
  }
  if (!json || typeof json.mappings !== 'string') return null;

  const sources = json.sources || [];
  const sourcesContent = json.sourcesContent || [];
  const names = json.names || [];

  const lines = [];
  // The deltas in a source map are cumulative ACROSS lines, so the running
  // srcIdx/srcLine/srcCol/nameIdx state lives outside the line loop.
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  let nameIdx = 0;

  for (const rawLine of json.mappings.split(';')) {
    const segments = [];
    let genCol = 0;
    if (rawLine) {
      for (const rawSeg of rawLine.split(',')) {
        if (!rawSeg) continue;
        const fields = decodeVlq(rawSeg);
        if (fields.length === 0) continue;
        genCol += fields[0];
        if (fields.length >= 4) {
          srcIdx += fields[1];
          srcLine += fields[2];
          srcCol += fields[3];
          let name;
          if (fields.length >= 5) {
            nameIdx += fields[4];
            name = names[nameIdx];
          }
          segments.push({ genCol, srcIdx, srcLine, srcCol, name });
        } else {
          // A one-field segment is a generated-only mapping (no source).
          segments.push({ genCol });
        }
      }
    }
    lines.push(segments);
  }

  return { sources, sourcesContent, names, lines };
}

/**
 * Map a GENERATED (1-based) line:column back to the original source.
 * Returns { source, line, column, name, content } or null when the position
 * cannot be mapped (blank generated line, or a line past the map).
 */
export function originalPosition(map, line, column) {
  if (!map || !Array.isArray(map.lines)) return null;
  const segments = map.lines[line - 1];
  if (!segments || segments.length === 0) return null;

  const genCol = Math.max(0, (column || 1) - 1);
  // The segment in effect at a position is the last one whose generated
  // column is <= the queried column.
  let match = null;
  for (const seg of segments) {
    if (seg.genCol <= genCol) match = seg;
    else break;
  }
  if (!match) return null;
  if (match.srcIdx === undefined) return null;

  return {
    source: map.sources[match.srcIdx] || null,
    line: match.srcLine + 1,
    column: match.srcCol + 1,
    name: match.name,
    content: map.sourcesContent[match.srcIdx] ?? null,
  };
}

/**
 * Render a Rust-compiler-style snippet around a mapped position, mirroring
 * formatBundleError's shape so runtime and compile errors look alike:
 *
 *    |
 *    4 |     throw new Error('boom');
 *    |     ^
 *
 * Returns '' when the source text or line is unavailable (mapping still
 * succeeded, so the caller prints the ` --> file:line:col` header anyway).
 */
export function formatSourceContext(content, line, column) {
  if (!content || !Number.isFinite(line) || line < 1) return '';
  const lines = String(content).split('\n');
  const idx = line - 1;
  if (idx >= lines.length) return '';
  const lineNum = String(line);
  const pad = ' '.repeat(lineNum.length);
  const caretCol = Math.max(0, (column || 1) - 1);
  return `\n ${pad}|\n ${lineNum} | ${lines[idx]}\n ${pad} | ${' '.repeat(caretCol)}^`;
}
