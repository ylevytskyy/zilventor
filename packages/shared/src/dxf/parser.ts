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

/** Extracts HEADER variables: each `9 <name>` maps to the value of the next pair. */
function parseHeader(pairs: DxfPair[]): Record<string, string> {
  const header: Record<string, string> = {};
  let inHeader = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[i + 1];
      inHeader = !!next && next.code === 2 && next.value === 'HEADER';
      continue;
    }
    if (p.code === 0 && (p.value === 'ENDSEC' || p.value === 'EOF')) { inHeader = false; continue; }
    if (inHeader && p.code === 9) {
      const valuePair = pairs[i + 1];
      if (valuePair && valuePair.code !== 9 && valuePair.code !== 0) header[p.value] = valuePair.value;
    }
  }
  return header;
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
    case 'ARC':
      return { type: 'ARC', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40),
        startAngle: num(raw.pairs, 50), endAngle: num(raw.pairs, 51) };
    case 'TEXT':
      return { type: 'TEXT', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20), height: num(raw.pairs, 40),
        value: str(raw.pairs, 1), rotation: num(raw.pairs, 50) };
    case 'MTEXT':
      return { type: 'MTEXT', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20), height: num(raw.pairs, 40),
        value: str(raw.pairs, 1), rotation: num(raw.pairs, 50) };
    case 'LWPOLYLINE': {
      const f = (s: string): number => { const n = Number.parseFloat(s); return Number.isFinite(n) ? n : 0; };
      const verts: Array<{ x: number; y: number; bulge: number }> = [];
      let cur: { x: number; y: number; bulge: number } | null = null;
      for (const q of raw.pairs) {
        if (q.code === 10) {
          if (cur) verts.push(cur);
          cur = { x: f(q.value), y: 0, bulge: 0 };
        } else if (q.code === 20 && cur) {
          cur.y = f(q.value);
        } else if (q.code === 42 && cur) {
          cur.bulge = f(q.value);
        }
      }
      if (cur) verts.push(cur);
      return { type: 'LWPOLYLINE', layer, closed: (num(raw.pairs, 70) & 1) === 1, vertices: verts };
    }
    case 'INSERT':
      return { type: 'INSERT', layer,
        name: str(raw.pairs, 2),
        x: num(raw.pairs, 10), y: num(raw.pairs, 20),
        xscale: num(raw.pairs, 41, 1), yscale: num(raw.pairs, 42, 1),
        rotation: num(raw.pairs, 50) };
    case 'SPLINE': {
      const f = (s: string): number => { const n = Number.parseFloat(s); return Number.isFinite(n) ? n : 0; };
      const cps: Array<{ x: number; y: number }> = [];
      let cx: number | null = null;
      for (const q of raw.pairs) {
        if (q.code === 10) cx = f(q.value);
        else if (q.code === 20 && cx !== null) { cps.push({ x: cx, y: f(q.value) }); cx = null; }
      }
      return { type: 'SPLINE', layer, degree: num(raw.pairs, 71, 3), closed: (num(raw.pairs, 70) & 1) === 1, controlPoints: cps };
    }
    case 'ELLIPSE':
      return { type: 'ELLIPSE', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20),
        majorX: num(raw.pairs, 11), majorY: num(raw.pairs, 21),
        ratio: num(raw.pairs, 40), startParam: num(raw.pairs, 41), endParam: num(raw.pairs, 42, 2 * Math.PI) };
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
  result.header = parseHeader(pairs);

  let section = '';
  let currentBlock: string | null = null;
  let raw: RawEntity | null = null;
  let polyline: { layer: string; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> } | null = null;

  const flush = (): void => {
    if (!raw) return;
    if (raw.type === '__POLYHDR__' && polyline) {
      polyline.layer = str(raw.pairs, 8, '0');
      polyline.closed = (num(raw.pairs, 70) & 1) === 1;
      raw = null;
      return;
    }
    if (raw.type === '__VERTEX__' && polyline) {
      polyline.vertices.push({ x: num(raw.pairs, 10), y: num(raw.pairs, 20), bulge: num(raw.pairs, 42) });
      raw = null;
      return;
    }
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
      } else if (kind === 'POLYLINE') {
        polyline = { layer: '0', closed: false, vertices: [] };
        raw = { type: '__POLYHDR__', pairs: [] };
      } else if (kind === 'VERTEX') {
        raw = { type: '__VERTEX__', pairs: [] };
      } else if (kind === 'SEQEND') {
        if (polyline) {
          const ent: DxfEntity = { type: 'POLYLINE', layer: polyline.layer, closed: polyline.closed, vertices: polyline.vertices };
          if (section === 'ENTITIES') result.entities.push(ent);
          else if (section === 'BLOCKS' && currentBlock) (result.blocks[currentBlock] ??= []).push(ent);
          polyline = null;
        }
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
