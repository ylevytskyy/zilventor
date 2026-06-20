import { tokenize } from './tokenizer';
import type { DxfPair, DxfEntity, ParsedDxf } from './types';

/** A raw entity record: its type plus a code→values multimap of its attribute pairs. */
type RawEntity = { type: string; pairs: DxfPair[] };

function num(pairs: DxfPair[], code: number, fallback = 0): number {
  const p = pairs.find((q) => q.code === code);
  if (!p) return fallback;
  const n = Number.parseFloat(p.value);
  return Number.isFinite(n) ? n : fallback;
}

function str(pairs: DxfPair[], code: number, fallback = ''): string {
  return pairs.find((q) => q.code === code)?.value ?? fallback;
}

function readEntity(raw: RawEntity): DxfEntity | null {
  const layer = str(raw.pairs, 8, '0');
  switch (raw.type) {
    case 'LINE':
      return { type: 'LINE', layer,
        x1: num(raw.pairs, 10), y1: num(raw.pairs, 20),
        x2: num(raw.pairs, 11), y2: num(raw.pairs, 21) };
    case 'CIRCLE':
      return { type: 'CIRCLE', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40) };
    default:
      return null;
  }
}

export function parseDxf(text: string): ParsedDxf {
  const result: ParsedDxf = { entities: [], blocks: {}, header: {} };
  let pairs: DxfPair[];
  try {
    pairs = tokenize(text);
  } catch {
    return result;
  }

  let section = '';
  let currentBlock: string | null = null;
  let raw: RawEntity | null = null;

  const flush = (): void => {
    if (!raw) return;
    const ent = readEntity(raw);
    if (ent) {
      if (section === 'BLOCKS' && currentBlock) {
        (result.blocks[currentBlock] ??= []).push(ent);
      } else if (section === 'ENTITIES') {
        result.entities.push(ent);
      }
    }
    raw = null;
  };

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0) {
      flush();
      const kind = p.value;
      if (kind === 'SECTION') {
        const next = pairs[i + 1];
        section = next && next.code === 2 ? next.value : '';
        currentBlock = null;
      } else if (kind === 'ENDSEC') {
        section = '';
        currentBlock = null;
      } else if (kind === 'BLOCK') {
        raw = { type: '__BLOCK__', pairs: [] }; // header pairs collected below; name read on next BLOCK/ENDBLK
      } else if (kind === 'ENDBLK') {
        currentBlock = null;
      } else if (kind === 'EOF') {
        break;
      } else {
        raw = { type: kind, pairs: [] };
      }
    } else if (raw) {
      raw.pairs.push(p);
      if (raw.type === '__BLOCK__' && p.code === 2) {
        currentBlock = p.value;
        result.blocks[currentBlock] ??= [];
        raw = null; // block header consumed; following entities belong to this block
      }
    }
  }
  flush();
  return result;
}
