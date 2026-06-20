import type { DxfPair } from './types';

/**
 * Split raw DXF ASCII text into (code, value) pairs.
 * Each record is a group-code line followed by a value line. Lines are trimmed;
 * a non-integer code line is skipped (defensive — never throws). A trailing code
 * with no value line is dropped.
 */
export function tokenize(text: string): DxfPair[] {
  const lines = text.split('\n');
  const out: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; ) {
    const codeStr = lines[i]!.trim();
    const code = Number.parseInt(codeStr, 10);
    if (!Number.isInteger(code) || codeStr === '' || /[^\d-]/.test(codeStr)) {
      i += 1;
      continue;
    }
    const value = lines[i + 1]!.trim();
    out.push({ code, value });
    i += 2;
  }
  return out;
}
