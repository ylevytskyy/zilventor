import { createDxfDocument, type DxfDocument } from './dxfWriter';
import { MANUFACTURING_LAYERS as L } from './manufacturingLayers';
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

function boreToFlat(b: BoreOp, len: number, wid: number): { x: number; y: number; layer: string } {
  switch (b.face) {
    case 'Top':    return { x: b.u, y: b.v, layer: L.boresFront(b.diameter) };
    case 'Bottom': return { x: b.u, y: wid - b.v, layer: L.boresBack(b.diameter) };
    case 'Front':  return { x: b.v, y: wid, layer: L.boresEdge('Front', b.diameter) };
    case 'Back':   return { x: len - b.v, y: 0, layer: L.boresEdge('Back', b.diameter) };
    case 'Left':   return { x: 0, y: b.v, layer: L.boresEdge('Left', b.diameter) };
    case 'Right':  return { x: len, y: wid - b.v, layer: L.boresEdge('Right', b.diameter) };
  }
}

function drawBores(doc: DxfDocument, bores: BoreOp[], len: number, wid: number): void {
  for (const b of bores) {
    const f = boreToFlat(b, len, wid);
    doc.circle(f.layer, f.x, f.y, b.diameter / 2);
    doc.text(L.boreInfo, f.x + b.diameter / 2 + 1, f.y, 4, boreLabel(b));
  }
}

function drawOutline(doc: DxfDocument, len: number, wid: number): void {
  doc.lwpolyline(L.outline,
    [{ x: 0, y: 0 }, { x: len, y: 0 }, { x: len, y: wid }, { x: 0, y: wid }], true);
}

function drawInfo(doc: DxfDocument, input: PanelManufacturingInput, wid: number): void {
  const { spec } = input;
  const lines = [
    `#${input.itemNumber} ${input.partName}`,
    input.materialName,
    `${spec.length}x${spec.width}x${spec.thickness}`,
    `Qty: ${input.qty}`,
  ];
  const h = 8;
  lines.forEach((s, i) => doc.text(L.info, 0, wid + 20 + (lines.length - 1 - i) * (h + 4), h, s));
}

function drawDim(
  doc: DxfDocument, layer: string, p1: [number, number], p2: [number, number],
  dimLine: [number, number], rotation: number, label: string,
): void {
  const mid: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const textMid: [number, number] = [(dimLine[0] + mid[0]) / 2 + 1, (dimLine[1] + mid[1]) / 2 + 1];
  const blockName = doc.block(() => {
    doc.line(layer, dimLine[0] === p1[0] ? dimLine[0] : p1[0], dimLine[1] === p1[1] ? dimLine[1] : p1[1],
      dimLine[0] === p2[0] ? dimLine[0] : p2[0], dimLine[1] === p2[1] ? dimLine[1] : p2[1]);
    doc.text(layer, textMid[0], textMid[1], 5, label);
  });
  doc.dimension({
    layer, blockName, dimStyle: 'STANDARD', dimType: 0,
    defPoint: dimLine, textMid, text: label, rotation,
    extraPoints: [[13, p1[0], p1[1]], [14, p2[0], p2[1]]],
  });
}

function grooveRect(
  g: GrooveFeature, len: number, wid: number,
): Array<{ x: number; y: number }> | null {
  if (g.faceRole !== 'Top' && g.faceRole !== 'Bottom') return null;
  const mirror = g.faceRole === 'Bottom';
  if (g.axis === 'u') {
    let y0 = g.position, y1 = g.position + g.width;
    if (mirror) { y0 = wid - g.position; y1 = wid - (g.position + g.width); }
    return [{ x: 0, y: y0 }, { x: len, y: y0 }, { x: len, y: y1 }, { x: 0, y: y1 }];
  } else {
    const x0 = g.position, x1 = g.position + g.width;
    return [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: wid }, { x: x0, y: wid }];
  }
}

function drawGrooves(doc: DxfDocument, grooves: GrooveFeature[], len: number, wid: number): void {
  for (const g of grooves) {
    const r = grooveRect(g, len, wid);
    if (r) doc.lwpolyline(L.grooves, r, true);
  }
}

const EDGE_LINE: Record<PanelEdgeKey, (len: number, wid: number) => [number, number, number, number]> = {
  front:  (_len, wid) => [0, wid, _len, wid],
  back:   (len)       => [0, 0, len, 0],
  left:   (_len, wid) => [0, 0, 0, wid],
  right:  (len, wid)  => [len, 0, len, wid],
};

function drawEdgeBands(doc: DxfDocument, spec: PanelSpec, len: number, wid: number): void {
  (Object.keys(EDGE_LINE) as PanelEdgeKey[]).forEach((edge) => {
    if (spec.edgeBands[edge]) {
      const [x1, y1, x2, y2] = EDGE_LINE[edge](len, wid);
      doc.line(L.edgeband, x1, y1, x2, y2);
    }
  });
}

function drawGrain(doc: DxfDocument, spec: PanelSpec, len: number, wid: number): void {
  if (spec.grain === 'none') return;
  const cx = len / 2, cy = wid / 2;
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
