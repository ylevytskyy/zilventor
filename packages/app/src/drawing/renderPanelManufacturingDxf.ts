import { createDxfDocument, type DxfDocument, type XdataItem } from './dxfWriter';
import { MANUFACTURING_LAYERS as L } from './manufacturingLayers';
import { layoutCombinedGrid } from './layoutCombinedGrid';
import { abfBoreLayer, ABF_OUTLINE_LAYER } from './abfLayerScheme';
import { buildTenonMortiseCutters } from '@zilventor/shared';
import type { PanelSpec, BoreOp, GrooveFeature, TenonMortiseFeature, KeyholeSlotFeature, PanelEdgeKey } from '@zilventor/shared';

/** DXF layer-naming scheme: 'native' (existing MANUFACTURING_LAYERS) or 'abf' (ABF-compatible,
 *  see abfLayerScheme.ts). Omitted/'native' is byte-identical to the pre-existing output. */
export type LayerScheme = 'native' | 'abf';
export type RenderDxfOpts = { layerScheme?: LayerScheme };

/**
 * CAM metadata (R2.2) → DXF XDATA convention: a labeled key/value pair per
 * present field — {1000:'TOOL_NUMBER'},{1070:toolNumber} and/or
 * {1000:'SPEED'},{1040:speed} — under the ZILVENTOR APPID. Absent fields emit
 * nothing (undefined arg to circle()/lwpolyline() → no XDATA at all), so
 * entities with no CAM metadata are byte-identical to pre-CAM-metadata output.
 */
function camXdata(op: { toolNumber?: number; speed?: number }): XdataItem[] | undefined {
  const items: XdataItem[] = [];
  if (op.toolNumber !== undefined) items.push({ code: 1000, value: 'TOOL_NUMBER' }, { code: 1070, value: op.toolNumber });
  if (op.speed !== undefined) items.push({ code: 1000, value: 'SPEED' }, { code: 1040, value: op.speed });
  return items.length > 0 ? items : undefined;
}

export type PanelManufacturingInput = {
  itemNumber: number;
  partName: string;
  spec: PanelSpec;
  materialName: string;
  bores: BoreOp[];
  grooves: GrooveFeature[];
  /** Absent (legacy fixtures/callers) is treated as empty, mirroring grooves' precedent
   *  minus the required-field ripple — deliberate deviation, see manufacturingCsv.ts /
   *  aggregatePanelManufacturing.ts (P6 W4 report: keeps PanelManufacturingInput
   *  construction sites outside this slice's turf, e.g. ExportPanelManufacturingDxfCommand,
   *  compiling unchanged). */
  tenonMortises?: TenonMortiseFeature[];
  /** Same absent-is-empty contract as tenonMortises (P16). */
  keyholeSlots?: KeyholeSlotFeature[];
  qty: number;
};

const VALID_FACE_ROLES = new Set(['Top', 'Bottom', 'Front', 'Back', 'Left', 'Right']);

function boreLabel(b: BoreOp): string {
  // DXF R12 diameter symbol = %%c (see renderDrawingDxf.ts:525-526)
  return b.depth === 'throughAll' ? `%%c${b.diameter} THRU` : `%%c${b.diameter}x${b.depth}`;
}

/** Exported so manufacturingCsv.ts reuses the same default-layer derivation as the DXF writer instead of duplicating it. */
export function boreToFlat(b: BoreOp, len: number, wid: number): { x: number; y: number; layer: string } | null {
  switch (b.face.role) {
    case 'Top':    return { x: b.u, y: b.v, layer: L.boresFront(b.diameter) };
    case 'Bottom': return { x: b.u, y: wid - b.v, layer: L.boresBack(b.diameter) };
    case 'Front':  return { x: b.v, y: wid, layer: L.boresEdge('Front', b.diameter) };
    case 'Back':   return { x: len - b.v, y: 0, layer: L.boresEdge('Back', b.diameter) };
    case 'Left':   return { x: 0, y: b.v, layer: L.boresEdge('Left', b.diameter) };
    case 'Right':  return { x: len, y: wid - b.v, layer: L.boresEdge('Right', b.diameter) };
    default:       return null;
  }
}

/** Face (Top/Bottom, the two large thickness-normal faces) vs edge (Front/Back/Left/Right)
 *  orientation, for abfBoreLayer's face-vs-edge convention. Mirrors boreToFlat's own
 *  role classification. Exported so other ABF-scheme DXF renderers (e.g.
 *  renderViyarProFlattenDxf.ts) reuse this classification instead of re-deriving it. */
export function boreOrientation(role: BoreOp['face']['role']): 'face' | 'edge' {
  return role === 'Top' || role === 'Bottom' ? 'face' : 'edge';
}

/** Effective DXF layer for a bore: presetLayerName ALWAYS wins; else under the 'abf' scheme
 *  abfBoreLayer's name (falling back to the native name when it returns null, e.g. a
 *  throughAll bore — no invented THRU convention); else the native name. */
function boreLayer(b: BoreOp, nativeLayer: string, scheme: LayerScheme): string {
  if (b.presetLayerName !== undefined) return b.presetLayerName;
  if (scheme === 'abf') {
    const abfLayer = abfBoreLayer(b, boreOrientation(b.face.role));
    if (abfLayer !== null) return abfLayer;
  }
  return nativeLayer;
}

function drawBores(doc: DxfDocument, bores: BoreOp[], len: number, wid: number, dx = 0, dy = 0, scheme: LayerScheme = 'native'): void {
  for (const b of bores) {
    const f = boreToFlat(b, len, wid);
    if (!f) continue;
    doc.circle(boreLayer(b, f.layer, scheme), f.x + dx, f.y + dy, b.diameter / 2, camXdata(b));
    doc.text(L.boreInfo, f.x + dx + b.diameter / 2 + 1, f.y + dy, 4, boreLabel(b));
  }
}

function drawOutline(doc: DxfDocument, len: number, wid: number, dx = 0, dy = 0, scheme: LayerScheme = 'native'): void {
  const layer = scheme === 'abf' ? ABF_OUTLINE_LAYER : L.outline;
  doc.lwpolyline(layer,
    [{ x: dx, y: dy }, { x: len + dx, y: dy }, { x: len + dx, y: wid + dy }, { x: dx, y: wid + dy }], true);
}

function drawInfo(doc: DxfDocument, input: PanelManufacturingInput, wid: number, dx = 0, dy = 0): void {
  const { spec } = input;
  const lines = [
    `#${input.itemNumber} ${input.partName}`,
    input.materialName,
    `${spec.length}x${spec.width}x${spec.thickness}`,
    `Qty: ${input.qty}`,
  ];
  const h = 8;
  lines.forEach((s, i) => doc.text(L.info, dx, wid + dy + 20 + (lines.length - 1 - i) * (h + 4), h, s));
}

function drawDim(
  doc: DxfDocument, layer: string, p1: [number, number], p2: [number, number],
  dimLine: [number, number], rotation: number, label: string, dx = 0, dy = 0,
): void {
  const shift = (p: [number, number]): [number, number] => [p[0] + dx, p[1] + dy];
  const [sp1, sp2, sDimLine] = [shift(p1), shift(p2), shift(dimLine)];
  const mid: [number, number] = [(sp1[0] + sp2[0]) / 2, (sp1[1] + sp2[1]) / 2];
  const textMid: [number, number] = [(sDimLine[0] + mid[0]) / 2 + 1, (sDimLine[1] + mid[1]) / 2 + 1];
  const blockName = doc.block(() => {
    doc.line(layer, sDimLine[0] === sp1[0] ? sDimLine[0] : sp1[0], sDimLine[1] === sp1[1] ? sDimLine[1] : sp1[1],
      sDimLine[0] === sp2[0] ? sDimLine[0] : sp2[0], sDimLine[1] === sp2[1] ? sDimLine[1] : sp2[1]);
    doc.text(layer, textMid[0], textMid[1], 5, label);
  });
  doc.dimension({
    layer, blockName, dimStyle: 'STANDARD', dimType: 0,
    defPoint: sDimLine, textMid, text: label, rotation,
    extraPoints: [[13, sp1[0], sp1[1]], [14, sp2[0], sp2[1]]],
  });
}

/** Exported so manufacturingCsv.ts reuses the same accept/reject rule as the DXF writer instead of duplicating it. */
export function grooveRect(
  g: GrooveFeature, len: number, wid: number,
): Array<{ x: number; y: number }> | null {
  if (g.faceRole !== 'Top' && g.faceRole !== 'Bottom') return null;
  const mirror = g.faceRole === 'Bottom';
  if (g.axis === 'u') {
    // kernel cuts CENTERED at position: [position - width/2, position + width/2]
    let y0 = g.position - g.width / 2, y1 = g.position + g.width / 2;
    if (mirror) { y0 = wid - (g.position - g.width / 2); y1 = wid - (g.position + g.width / 2); }
    return [{ x: 0, y: y0 }, { x: len, y: y0 }, { x: len, y: y1 }, { x: 0, y: y1 }];
  } else {
    // kernel cuts CENTERED at position: [position - width/2, position + width/2]
    const x0 = g.position - g.width / 2, x1 = g.position + g.width / 2;
    return [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: wid }, { x: x0, y: wid }];
  }
}

function drawGrooves(doc: DxfDocument, grooves: GrooveFeature[], len: number, wid: number, dx = 0, dy = 0): void {
  for (const g of grooves) {
    const r = grooveRect(g, len, wid);
    if (r) doc.lwpolyline(g.presetLayerName ?? L.grooves, r.map((p) => ({ x: p.x + dx, y: p.y + dy })), true, camXdata(g));
  }
}

/**
 * Exported so manufacturingCsv.ts reuses the same accept/reject + per-tab rect derivation
 * as the DXF writer instead of duplicating it. Unlike grooveRect (Top/Bottom faces only),
 * this handles all 6 PanelFaceRole values — generateTenonMortisePair (tenonMortiseMath.ts)
 * can place either role on any face role depending on the inferred joint's orientation
 * (e.g. a 'Left'+'Top' joint puts the tenon ON the Top face and the mortise ON the Left
 * face), so restricting to Top/Bottom like grooveRect would silently drop real features.
 *
 * Reuses buildTenonMortiseCutters (the exact 3D-cutter math shared with the kernel) rather
 * than re-deriving a per-face flattening table, so these 2D rects are provably consistent
 * with the 3D boxes: every face's world (x,y) is just the panel-centered frame
 * ([-len/2,len/2]x[-wid/2,wid/2]) shifted to the DXF's corner-origin frame ([0,len]x[0,wid]);
 * world z is always dropped. `thickness` is passed as 0 because — verified against
 * face2DFrame/faceExtents (packages/shared/src/bore.ts) — the thickness axis is always
 * routed to world z for every face (uDir is (0,0,1) on Left/Right/Front/Back; Top/Bottom's
 * u/v never reference thickness at all), so its magnitude never reaches x or y.
 */
export function tenonMortiseRects(
  f: TenonMortiseFeature, len: number, wid: number,
): Array<Array<{ x: number; y: number }>> | null {
  if (!VALID_FACE_ROLES.has(f.faceRole)) return null;
  const boxes = buildTenonMortiseCutters({ length: len, width: wid, thickness: 0 }, f);
  if (boxes.length === 0) return null;
  const hL = len / 2, hW = wid / 2;
  return boxes.map(({ p1, p2 }) => {
    const x0 = Math.min(p1.x, p2.x) + hL, x1 = Math.max(p1.x, p2.x) + hL;
    const y0 = Math.min(p1.y, p2.y) + hW, y1 = Math.max(p1.y, p2.y) + hW;
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  });
}

function drawTenonMortises(
  doc: DxfDocument, features: TenonMortiseFeature[], len: number, wid: number, dx = 0, dy = 0,
): void {
  for (const f of features) {
    const rects = tenonMortiseRects(f, len, wid);
    if (!rects) continue;
    const layer = f.presetLayerName ?? (f.role === 'tenon' ? L.tenons : L.mortises);
    for (const r of rects) {
      doc.lwpolyline(layer, r.map((p) => ({ x: p.x + dx, y: p.y + dy })), true, camXdata(f));
    }
  }
}

/**
 * Exported so manufacturingCsv.ts reuses the same accept/reject + point placement as the
 * DXF writer. Like grooveRect, restricted to Top/Bottom faces: this flat panel-plan drawing
 * shows Front/Back/Left/Right edges as 1D border lines (no width/thickness cross-section
 * view), so a keyhole slot's WIDTH — whichever local axis ISN'T the run axis — has no
 * representable extent on an edge face. axis/direction pick the run direction in the
 * face's (u,v) frame; Bottom mirrors v the same way grooveRect/boreToFlat do.
 */
export function keyholeSlotFlat(
  f: KeyholeSlotFeature, len: number, wid: number,
): { circle: { x: number; y: number }; rect: Array<{ x: number; y: number }> } | null {
  if (f.faceRole !== 'Top' && f.faceRole !== 'Bottom') return null;
  const mirror = f.faceRole === 'Bottom';
  const cx = f.u;
  const cy = mirror ? wid - f.v : f.v;
  const runX = f.axis === 'u' ? 1 : 0;
  const runY = f.axis === 'v' ? (mirror ? -1 : 1) : 0;
  const farX = cx + runX * f.direction * f.slotLength;
  const farY = cy + runY * f.direction * f.slotLength;
  const half = f.slotWidth / 2;
  const crossX = f.axis === 'v' ? 1 : 0;
  const crossY = f.axis === 'u' ? (mirror ? -1 : 1) : 0;
  const rect = [
    { x: cx - crossX * half, y: cy - crossY * half },
    { x: cx + crossX * half, y: cy + crossY * half },
    { x: farX + crossX * half, y: farY + crossY * half },
    { x: farX - crossX * half, y: farY - crossY * half },
  ];
  return { circle: { x: cx, y: cy }, rect };
}

function drawKeyholeSlots(
  doc: DxfDocument, slots: KeyholeSlotFeature[], len: number, wid: number, dx = 0, dy = 0,
): void {
  for (const s of slots) {
    const flat = keyholeSlotFlat(s, len, wid);
    if (!flat) continue;
    const layer = s.presetLayerName ?? L.keyholeSlots;
    doc.circle(layer, flat.circle.x + dx, flat.circle.y + dy, s.entryDiameter / 2, camXdata(s));
    doc.lwpolyline(layer, flat.rect.map((p) => ({ x: p.x + dx, y: p.y + dy })), true, camXdata(s));
  }
}

const EDGE_LINE: Record<PanelEdgeKey, (len: number, wid: number) => [number, number, number, number]> = {
  front:  (_len, wid) => [0, wid, _len, wid],
  back:   (len)       => [0, 0, len, 0],
  left:   (_len, wid) => [0, 0, 0, wid],
  right:  (len, wid)  => [len, 0, len, wid],
};

function drawEdgeBands(doc: DxfDocument, spec: PanelSpec, len: number, wid: number, dx = 0, dy = 0): void {
  (Object.keys(EDGE_LINE) as PanelEdgeKey[]).forEach((edge) => {
    if (spec.edgeBands[edge]) {
      const [x1, y1, x2, y2] = EDGE_LINE[edge](len, wid);
      doc.line(L.edgeband, x1 + dx, y1 + dy, x2 + dx, y2 + dy);
    }
  });
}

function drawGrain(doc: DxfDocument, spec: PanelSpec, len: number, wid: number, dx = 0, dy = 0): void {
  if (spec.grain === 'none') return;
  const cx = len / 2 + dx, cy = wid / 2 + dy;
  if (spec.grain === 'length') {
    const a = len * 0.3;
    doc.line(L.grain, cx - a, cy, cx + a, cy);
    doc.line(L.grain, cx + a, cy, cx + a - 10, cy + 6);
    doc.line(L.grain, cx + a, cy, cx + a - 10, cy - 6);
  } else {
    const a = wid * 0.3;
    doc.line(L.grain, cx, cy - a, cx, cy + a);
    doc.line(L.grain, cx, cy + a, cx + 6, cy + a - 10);
    doc.line(L.grain, cx, cy + a, cx - 6, cy + a - 10);
  }
}

export function renderPanelManufacturingDxf(input: PanelManufacturingInput, opts?: RenderDxfOpts): string {
  const scheme = opts?.layerScheme ?? 'native';
  const doc = createDxfDocument(neededLayers(input, scheme));
  const len = input.spec.length;
  const wid = input.spec.width;
  drawOutline(doc, len, wid, 0, 0, scheme);
  drawBores(doc, input.bores, len, wid, 0, 0, scheme);
  drawGrooves(doc, input.grooves, len, wid);
  drawTenonMortises(doc, input.tenonMortises ?? [], len, wid);
  drawKeyholeSlots(doc, input.keyholeSlots ?? [], len, wid);
  drawEdgeBands(doc, input.spec, len, wid);
  drawGrain(doc, input.spec, len, wid);
  // L dimension (horizontal, below the panel)
  drawDim(doc, L.dimensions, [0, -15], [len, -15], [0, -15], 0, `${len}`);
  // W dimension (vertical, left of the panel)
  drawDim(doc, L.dimensions, [-15, 0], [-15, wid], [-15, 0], 90, `${wid}`);
  drawInfo(doc, input, wid);
  return doc.toString();
}

/** Layer names one panel's manufacturing entities actually draw into (mirrors renderPanelManufacturingDxf's calls). */
function neededLayers(input: PanelManufacturingInput, scheme: LayerScheme): string[] {
  const layers = new Set<string>([scheme === 'abf' ? ABF_OUTLINE_LAYER : L.outline, L.info, L.dimensions]);
  for (const b of input.bores) {
    const f = boreToFlat(b, input.spec.length, input.spec.width);
    if (f) { layers.add(boreLayer(b, f.layer, scheme)); layers.add(L.boreInfo); }
  }
  for (const g of input.grooves) {
    if (grooveRect(g, input.spec.length, input.spec.width)) layers.add(g.presetLayerName ?? L.grooves);
  }
  for (const f of input.tenonMortises ?? []) {
    if (tenonMortiseRects(f, input.spec.length, input.spec.width)) {
      layers.add(f.presetLayerName ?? (f.role === 'tenon' ? L.tenons : L.mortises));
    }
  }
  for (const s of input.keyholeSlots ?? []) {
    if (keyholeSlotFlat(s, input.spec.length, input.spec.width)) layers.add(s.presetLayerName ?? L.keyholeSlots);
  }
  if (Object.values(input.spec.edgeBands).some(Boolean)) layers.add(L.edgeband);
  if (input.spec.grain !== 'none') layers.add(L.grain);
  return [...layers];
}

/**
 * One DXF document containing ALL given panels' manufacturing geometry, laid out on a
 * row-wrapped grid (50mm gutter, see layoutCombinedGrid) instead of one file per panel.
 * Single header + single LAYER table (deduped union of every layer any panel needs).
 */
export function renderCombinedManufacturingDxf(inputs: PanelManufacturingInput[], opts?: RenderDxfOpts): string {
  const scheme = opts?.layerScheme ?? 'native';
  const offsets = layoutCombinedGrid(
    inputs.map((i) => ({ width: i.spec.length, height: i.spec.width })),
    50,
  );
  const allLayers = new Set<string>();
  for (const input of inputs) for (const layer of neededLayers(input, scheme)) allLayers.add(layer);

  const doc = createDxfDocument([...allLayers]);
  inputs.forEach((input, idx) => {
    const { x: dx, y: dy } = offsets[idx]!;
    const len = input.spec.length;
    const wid = input.spec.width;
    drawOutline(doc, len, wid, dx, dy, scheme);
    drawBores(doc, input.bores, len, wid, dx, dy, scheme);
    drawGrooves(doc, input.grooves, len, wid, dx, dy);
    drawTenonMortises(doc, input.tenonMortises ?? [], len, wid, dx, dy);
    drawKeyholeSlots(doc, input.keyholeSlots ?? [], len, wid, dx, dy);
    drawEdgeBands(doc, input.spec, len, wid, dx, dy);
    drawGrain(doc, input.spec, len, wid, dx, dy);
    drawDim(doc, L.dimensions, [0, -15], [len, -15], [0, -15], 0, `${len}`, dx, dy);
    drawDim(doc, L.dimensions, [-15, 0], [-15, wid], [-15, 0], 90, `${wid}`, dx, dy);
    drawInfo(doc, input, wid, dx, dy);
  });
  return doc.toString();
}
