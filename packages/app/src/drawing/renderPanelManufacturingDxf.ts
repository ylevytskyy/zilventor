import { createDxfDocument, type DxfDocument } from './dxfWriter';
import { MANUFACTURING_LAYERS as L } from './manufacturingLayers';
import { layoutCombinedGrid } from './layoutCombinedGrid';
import type { PanelSpec, BoreOp, GrooveFeature, PanelEdgeKey } from '@zilventor/shared';

export type PanelManufacturingInput = {
  itemNumber: number;
  partName: string;
  spec: PanelSpec;
  materialName: string;
  bores: BoreOp[];
  grooves: GrooveFeature[];
  qty: number;
};

function boreLabel(b: BoreOp): string {
  return b.depth === 'throughAll' ? `O${b.diameter} THRU` : `O${b.diameter}x${b.depth}`;
}

function boreToFlat(b: BoreOp, len: number, wid: number): { x: number; y: number; layer: string } | null {
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

function drawBores(doc: DxfDocument, bores: BoreOp[], len: number, wid: number, dx = 0, dy = 0): void {
  for (const b of bores) {
    const f = boreToFlat(b, len, wid);
    if (!f) continue;
    doc.circle(f.layer, f.x + dx, f.y + dy, b.diameter / 2);
    doc.text(L.boreInfo, f.x + dx + b.diameter / 2 + 1, f.y + dy, 4, boreLabel(b));
  }
}

function drawOutline(doc: DxfDocument, len: number, wid: number, dx = 0, dy = 0): void {
  doc.lwpolyline(L.outline,
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

function grooveRect(
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
    if (r) doc.lwpolyline(L.grooves, r.map((p) => ({ x: p.x + dx, y: p.y + dy })), true);
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

export function renderPanelManufacturingDxf(input: PanelManufacturingInput): string {
  const doc = createDxfDocument();
  const len = input.spec.length;
  const wid = input.spec.width;
  drawOutline(doc, len, wid);
  drawBores(doc, input.bores, len, wid);
  drawGrooves(doc, input.grooves, len, wid);
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
function neededLayers(input: PanelManufacturingInput): string[] {
  const layers = new Set<string>([L.outline, L.info, L.dimensions]);
  for (const b of input.bores) {
    const f = boreToFlat(b, input.spec.length, input.spec.width);
    if (f) { layers.add(f.layer); layers.add(L.boreInfo); }
  }
  if (input.grooves.some((g) => grooveRect(g, input.spec.length, input.spec.width))) layers.add(L.grooves);
  if (Object.values(input.spec.edgeBands).some(Boolean)) layers.add(L.edgeband);
  if (input.spec.grain !== 'none') layers.add(L.grain);
  return [...layers];
}

/**
 * One DXF document containing ALL given panels' manufacturing geometry, laid out on a
 * row-wrapped grid (50mm gutter, see layoutCombinedGrid) instead of one file per panel.
 * Single header + single LAYER table (deduped union of every layer any panel needs).
 */
export function renderCombinedManufacturingDxf(inputs: PanelManufacturingInput[]): string {
  const offsets = layoutCombinedGrid(
    inputs.map((i) => ({ width: i.spec.length, height: i.spec.width })),
    50,
  );
  const allLayers = new Set<string>();
  for (const input of inputs) for (const layer of neededLayers(input)) allLayers.add(layer);

  const doc = createDxfDocument([...allLayers]);
  inputs.forEach((input, idx) => {
    const { x: dx, y: dy } = offsets[idx]!;
    const len = input.spec.length;
    const wid = input.spec.width;
    drawOutline(doc, len, wid, dx, dy);
    drawBores(doc, input.bores, len, wid, dx, dy);
    drawGrooves(doc, input.grooves, len, wid, dx, dy);
    drawEdgeBands(doc, input.spec, len, wid, dx, dy);
    drawGrain(doc, input.spec, len, wid, dx, dy);
    drawDim(doc, L.dimensions, [0, -15], [len, -15], [0, -15], 0, `${len}`, dx, dy);
    drawDim(doc, L.dimensions, [-15, 0], [-15, wid], [-15, 0], 90, `${wid}`, dx, dy);
    drawInfo(doc, input, wid, dx, dy);
  });
  return doc.toString();
}
