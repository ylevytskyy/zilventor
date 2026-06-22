import { tokenize } from './tokenizer';
import type { DxfPair, DxfEntity, DxfLayer, ParsedDxf, HatchLoop, HatchEdge } from './types';
import { stripMText } from './toSketch';

/** A raw entity record: its type plus a code→values multimap of its attribute pairs. */
type RawEntity = { type: string; pairs: DxfPair[] };

function num(pairs: DxfPair[], code: number, fallback = 0): number {
  const p = pairs.find((q) => q.code === code);
  if (!p) return fallback;
  const n = Number.parseFloat(p.value);
  return Number.isFinite(n) ? n : fallback;
}

function nums(pairs: DxfPair[], code: number): number[] {
  const out: number[] = [];
  for (const q of pairs) if (q.code === code) { const n = Number.parseFloat(q.value); if (Number.isFinite(n)) out.push(n); }
  return out;
}

function str(pairs: DxfPair[], code: number, fallback = ''): string {
  return pairs.find((q) => q.code === code)?.value ?? fallback;
}

function extrusion(pairs: DxfPair[]): { x: number; y: number; z: number } | undefined {
  const has = pairs.some((q) => q.code === 210 || q.code === 220 || q.code === 230);
  if (!has) return undefined;
  return { x: num(pairs, 210, 0), y: num(pairs, 220, 0), z: num(pairs, 230, 1) };
}

// MLEADER CONTEXT_DATA is a nested brace structure inlined into the entity's group pairs.
// LIMITATION: validated against the AutoDesk/ezdxf spec, NOT a real CAD-exported file —
// re-verify on a real MLEADER DXF. Best-effort: any unrecognized content is ignored, never thrown.
function parseMleader(pairs: DxfPair[]): {
  leaderLines: Array<Array<{ x: number; y: number }>>;
  text?: { value: string; x: number; y: number; height: number; rotation: number };
} {
  const leaderLines: Array<Array<{ x: number; y: number }>> = [];
  let inContext = false, inLeader = false, inLine = false;
  let curLine: Array<{ x: number; y: number }> = [];
  let pendingX: number | null = null;
  let hasMText = false;
  let textValue = '', textX = 0, textY = 0, textH = 0, textRot = 0;

  for (const p of pairs) {
    const v = p.value;
    // Structural tokens: match by literal STRING ending in '{', never by code number.
    // Code 304 is overloaded: it carries BOTH the LEADER_LINE{ token AND plain mtext content.
    if (v.endsWith('{')) {
      if (v.startsWith('CONTEXT_DATA')) inContext = true;
      else if (v.startsWith('LEADER_LINE')) { inLine = true; curLine = []; pendingX = null; }
      else if (v.startsWith('LEADER')) inLeader = true;
      continue;
    }
    if (v === '}') {
      // Pop innermost open context first.
      if (inLine) { if (curLine.length) leaderLines.push(curLine); inLine = false; }
      else if (inLeader) inLeader = false;
      else if (inContext) inContext = false;
      continue;
    }
    if (inLine) {
      if (p.code === 10) pendingX = Number.parseFloat(v);
      else if (p.code === 20 && pendingX !== null) {
        const y = Number.parseFloat(v);
        if (Number.isFinite(pendingX) && Number.isFinite(y)) curLine.push({ x: pendingX, y });
        pendingX = null;
      }
      continue; // code 30 (z) ignored
    }
    if (inContext && !inLeader) {
      if (p.code === 290) hasMText = v.trim() === '1';
      else if (p.code === 304) textValue = stripMText(v);
      else if (p.code === 12) textX = Number.parseFloat(v);
      else if (p.code === 22) textY = Number.parseFloat(v);
      else if (p.code === 41) textH = Number.parseFloat(v);
      else if (p.code === 42) textRot = Number.parseFloat(v);
    }
  }

  return {
    leaderLines,
    ...(hasMText && textValue
      ? { text: { value: textValue, x: textX, y: textY, height: textH, rotation: textRot } }
      : {}),
  };
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

/** Extracts LAYER records from the TABLES section. */
function parseLayers(pairs: DxfPair[]): Record<string, DxfLayer> {
  const layers: Record<string, DxfLayer> = {};
  let inTables = false;
  let cur: DxfLayer | null = null;
  const commit = (): void => { if (cur) { layers[cur.name] = cur; cur = null; } };
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[i + 1];
      inTables = !!next && next.code === 2 && next.value === 'TABLES';
      continue;
    }
    if (p.code === 0 && (p.value === 'ENDSEC' || p.value === 'EOF')) { commit(); inTables = false; continue; }
    if (!inTables) continue;
    if (p.code === 0 && p.value === 'LAYER') { commit(); cur = { name: '', color: 0, linetype: '', flags: 0 }; continue; }
    if (p.code === 0) { commit(); continue; } // any other record ends the current LAYER
    if (!cur) continue;
    if (p.code === 2) cur.name = p.value;
    else if (p.code === 6) cur.linetype = p.value;
    else if (p.code === 62) cur.color = Number.parseInt(p.value, 10) || 0;
    else if (p.code === 70) cur.flags = Number.parseInt(p.value, 10) || 0;
  }
  commit();
  return layers;
}

/** Parse HATCH boundary loops via a forward cursor over the ordered group-code pairs.
 * HATCH repeats codes 10/20/40/50/51/72/73 across loops & edges; structure is by order+count,
 * so the bag helpers (num/nums) cannot parse it. Malformed loop/edge → skip, never throw. */
function parseHatchLoops(pairs: DxfPair[]): HatchLoop[] {
  const f = (s: string | undefined): number => { const n = Number.parseFloat(s ?? ''); return Number.isFinite(n) ? n : 0; };
  let i = pairs.findIndex((p) => p.code === 91);          // boundary-path-count code
  if (i < 0) return [];
  const loopCount = Math.trunc(f(pairs[i]!.value));
  i++;
  /** If the current pair has `code`, return its value and advance; else return undefined (no advance). */
  const take = (code: number): string | undefined => {
    if (i < pairs.length && pairs[i]!.code === code) { const v = pairs[i]!.value; i++; return v; }
    return undefined;
  };
  /** Advance until the current pair has one of `codes` (or end). */
  const seek = (...codes: number[]): void => { while (i < pairs.length && !codes.includes(pairs[i]!.code)) i++; };

  const loops: HatchLoop[] = [];
  for (let li = 0; li < loopCount; li++) {
    seek(92);                                              // each loop begins with path-type flag
    const pt = take(92);
    if (pt === undefined) break;                           // ran out of loops
    const pathType = Math.trunc(f(pt));

    if (pathType & 2) {
      // ----- POLYLINE path: 72 has-bulge, 73 is-closed, 93 vertex count, then 10/20[/42]* -----
      const hasBulge = Math.trunc(f(take(72))) === 1;
      const closed = Math.trunc(f(take(73))) === 1;
      const vcount = Math.trunc(f(take(93)));
      const vertices: Array<{ x: number; y: number; bulge: number }> = [];
      for (let v = 0; v < vcount; v++) {
        const xs = take(10); if (xs === undefined) break;
        const x = f(xs);
        const y = f(take(20));
        const bulge = hasBulge ? f(take(42)) : 0;
        vertices.push({ x, y, bulge });
      }
      loops.push({ kind: 'polyline', closed, vertices });
    } else {
      // ----- EDGE list: 93 edge count, then per edge a 72 type + type-specific codes -----
      const ecount = Math.trunc(f(take(93)));
      const edges: HatchEdge[] = [];
      for (let e = 0; e < ecount; e++) {
        const ts = take(72); if (ts === undefined) break;
        const etype = Math.trunc(f(ts));
        if (etype === 1) {                                 // line: 10 20 11 21
          const x1 = f(take(10)), y1 = f(take(20)), x2 = f(take(11)), y2 = f(take(21));
          edges.push({ kind: 'line', x1, y1, x2, y2 });
        } else if (etype === 2) {                          // circular arc: 10 20 40 50 51 73
          const cx = f(take(10)), cy = f(take(20)), r = f(take(40));
          const startAngle = f(take(50)), endAngle = f(take(51));
          const ccw = Math.trunc(f(take(73))) !== 0;
          edges.push({ kind: 'arc', cx, cy, r, startAngle, endAngle, ccw });
        } else if (etype === 3 || etype === 4) {           // elliptic arc / spline: Task 3
          break;
        } else {
          // unrecognised edge type → cannot know its code count; skip the rest of this loop's edges
          break;
        }
      }
      loops.push({ kind: 'edges', edges });
    }
  }
  return loops;
}

function readEntity(raw: RawEntity): DxfEntity | null {
  const layer = str(raw.pairs, 8, '0');
  switch (raw.type) {
    case 'LINE':
      return { type: 'LINE', layer,
        x1: num(raw.pairs, 10), y1: num(raw.pairs, 20),
        x2: num(raw.pairs, 11), y2: num(raw.pairs, 21) };
    case 'CIRCLE': {
      const ex = extrusion(raw.pairs);
      return { type: 'CIRCLE', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40),
        ...(ex ? { extrusion: ex } : {}) };
    }
    case 'ARC': {
      const ex = extrusion(raw.pairs);
      return { type: 'ARC', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40),
        startAngle: num(raw.pairs, 50), endAngle: num(raw.pairs, 51),
        ...(ex ? { extrusion: ex } : {}) };
    }
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
      const ex = extrusion(raw.pairs);
      return { type: 'LWPOLYLINE', layer, closed: (num(raw.pairs, 70) & 1) === 1, vertices: verts,
        ...(ex ? { extrusion: ex } : {}) };
    }
    case 'INSERT':
      return { type: 'INSERT', layer,
        name: str(raw.pairs, 2),
        x: num(raw.pairs, 10), y: num(raw.pairs, 20),
        xscale: num(raw.pairs, 41, 1), yscale: num(raw.pairs, 42, 1),
        rotation: num(raw.pairs, 50),
        columns: num(raw.pairs, 70, 1), rows: num(raw.pairs, 71, 1),
        colSpacing: num(raw.pairs, 44, 0), rowSpacing: num(raw.pairs, 45, 0) };
    case 'SPLINE': {
      const f = (s: string): number => { const n = Number.parseFloat(s); return Number.isFinite(n) ? n : 0; };
      const cps: Array<{ x: number; y: number }> = [];
      const fps: Array<{ x: number; y: number }> = [];
      let cx: number | null = null;
      let fx: number | null = null;
      for (const q of raw.pairs) {
        if (q.code === 10) cx = f(q.value);
        else if (q.code === 20 && cx !== null) { cps.push({ x: cx, y: f(q.value) }); cx = null; }
        else if (q.code === 11) fx = f(q.value);
        else if (q.code === 21 && fx !== null) { fps.push({ x: fx, y: f(q.value) }); fx = null; }
      }
      return { type: 'SPLINE', layer, degree: num(raw.pairs, 71, 3), closed: (num(raw.pairs, 70) & 1) === 1,
        controlPoints: cps, fitPoints: fps, knots: nums(raw.pairs, 40), weights: nums(raw.pairs, 41) };
    }
    case 'ELLIPSE': {
      const ex = extrusion(raw.pairs);
      return { type: 'ELLIPSE', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20),
        majorX: num(raw.pairs, 11), majorY: num(raw.pairs, 21),
        ratio: num(raw.pairs, 40), startParam: num(raw.pairs, 41), endParam: num(raw.pairs, 42, 2 * Math.PI),
        ...(ex ? { extrusion: ex } : {}) };
    }
    case 'POINT': {
      const ex = extrusion(raw.pairs);
      return { type: 'POINT', layer, x: num(raw.pairs, 10), y: num(raw.pairs, 20), ...(ex ? { extrusion: ex } : {}) };
    }
    case 'SOLID':
    case 'TRACE': {
      const ex = extrusion(raw.pairs);
      const p0 = { x: num(raw.pairs, 10), y: num(raw.pairs, 20) };
      const p1 = { x: num(raw.pairs, 11), y: num(raw.pairs, 21) };
      const p2 = { x: num(raw.pairs, 12), y: num(raw.pairs, 22) };
      const p3 = { x: num(raw.pairs, 13), y: num(raw.pairs, 23) };
      // ezdxf gotcha: screen/winding order is 0,1,3,2 (last two reversed). Triangle when p2 == p3.
      const eps = 1e-9;
      const isTri = Math.abs(p2.x - p3.x) < eps && Math.abs(p2.y - p3.y) < eps;
      const corners = isTri ? [p0, p1, p3] : [p0, p1, p3, p2];
      return { type: 'SOLID', layer, corners, ...(ex ? { extrusion: ex } : {}) };
    }
    case 'LEADER': {
      const xs = nums(raw.pairs, 10);
      const ys = nums(raw.pairs, 20);
      const n = Math.min(xs.length, ys.length);
      const vertices: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) vertices.push({ x: xs[i]!, y: ys[i]! });
      return { type: 'LEADER', layer, vertices };
    }
    case 'DIMENSION': {
      const block = str(raw.pairs, 2);
      return { type: 'DIMENSION', layer,
        ...(block ? { block } : {}),
        textOverride: str(raw.pairs, 1),
        measurement: num(raw.pairs, 42),
        textMidX: num(raw.pairs, 11), textMidY: num(raw.pairs, 21) };
    }
    case 'MLEADER':
    case 'MULTILEADER': {
      const ml = parseMleader(raw.pairs);
      return { type: 'MLEADER', layer, leaderLines: ml.leaderLines, ...(ml.text ? { text: ml.text } : {}) };
    }
    case '3DFACE': {
      // Corners c0–c3 from codes 10–13 / 20–23 / 30–33, in sequential polygon
      // order (NOT the SOLID 0,1,3,2 swap). Carry z for the planar gate in toSketch.
      const c0 = { x: num(raw.pairs, 10), y: num(raw.pairs, 20), z: num(raw.pairs, 30) };
      const c1 = { x: num(raw.pairs, 11), y: num(raw.pairs, 21), z: num(raw.pairs, 31) };
      const c2 = { x: num(raw.pairs, 12), y: num(raw.pairs, 22), z: num(raw.pairs, 32) };
      const c3 = { x: num(raw.pairs, 13), y: num(raw.pairs, 23), z: num(raw.pairs, 33) };
      const eps = 1e-9;
      const isTri = Math.abs(c3.x - c2.x) < eps && Math.abs(c3.y - c2.y) < eps && Math.abs(c3.z - c2.z) < eps;
      const corners = isTri ? [c0, c1, c2] : [c0, c1, c2, c3];
      return { type: '3DFACE', layer, corners };
    }
    case 'RAY':
      return { type: 'RAY', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20),
        dx: num(raw.pairs, 11), dy: num(raw.pairs, 21) };
    case 'XLINE':
      return { type: 'XLINE', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20),
        dx: num(raw.pairs, 11), dy: num(raw.pairs, 21) };
    case 'HATCH': {
      const ex = extrusion(raw.pairs);
      return { type: 'HATCH', layer, loops: parseHatchLoops(raw.pairs), ...(ex ? { extrusion: ex } : {}) };
    }
    default:
      return null;
  }
}

export function parseDxf(text: string): ParsedDxf {
  const result: ParsedDxf = { entities: [], blocks: {}, header: {}, layers: {}, blockBasePoints: {} };
  let pairs: DxfPair[];
  try {
    pairs = tokenize(text);
  } catch {
    return result;
  }
  result.header = parseHeader(pairs);
  result.layers = parseLayers(pairs);

  let section = '';
  let currentBlock: string | null = null;
  let raw: RawEntity | null = null;
  let polyline: { layer: string; closed: boolean; extrusion?: { x: number; y: number; z: number }; vertices: Array<{ x: number; y: number; bulge: number }> } | null = null;

  const flush = (): void => {
    if (!raw) return;
    if (raw.type === '__POLYHDR__' && polyline) {
      polyline.layer = str(raw.pairs, 8, '0');
      polyline.closed = (num(raw.pairs, 70) & 1) === 1;
      const ex = extrusion(raw.pairs);
      if (ex) polyline.extrusion = ex;
      raw = null;
      return;
    }
    if (raw.type === '__VERTEX__' && polyline) {
      polyline.vertices.push({ x: num(raw.pairs, 10), y: num(raw.pairs, 20), bulge: num(raw.pairs, 42) });
      raw = null;
      return;
    }
    if (raw.type === '__BLOCK__') {
      if (currentBlock) result.blockBasePoints[currentBlock] = { x: num(raw.pairs, 10), y: num(raw.pairs, 20) };
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
          const ent: DxfEntity = { type: 'POLYLINE', layer: polyline.layer, closed: polyline.closed, vertices: polyline.vertices,
            ...(polyline.extrusion ? { extrusion: polyline.extrusion } : {}) };
          if (section === 'ENTITIES') result.entities.push(ent);
          else if (section === 'BLOCKS' && currentBlock) (result.blocks[currentBlock] ??= []).push(ent);
          polyline = null;
        }
      } else {
        raw = { type: kind, pairs: [] };
      }
    } else if (raw) {
      raw.pairs.push(p);
      if (raw.type === '__BLOCK__' && p.code === 2 && !currentBlock) {
        currentBlock = p.value;
        result.blocks[currentBlock] ??= [];
        // keep raw alive: base point (10/20) follows the name pair and will be read in flush()
      }
    }
  }
  flush();
  return result;
}
