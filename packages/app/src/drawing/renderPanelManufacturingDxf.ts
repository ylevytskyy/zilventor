import { createDxfDocument, type DxfDocument } from './dxfWriter';
import { MANUFACTURING_LAYERS as L } from './manufacturingLayers';
import type { PanelSpec, BoreOp, GrooveFeature } from '@zilventor/shared';

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

export function renderPanelManufacturingDxf(input: PanelManufacturingInput): string {
  const doc = createDxfDocument();
  const len = input.spec.length;
  const wid = input.spec.width;
  drawOutline(doc, len, wid);
  drawBores(doc, input.bores, len, wid);
  // L dimension (horizontal, below the panel)
  drawDim(doc, L.dimensions, [0, -15], [len, -15], [0, -15], 0, `${len}`);
  // W dimension (vertical, left of the panel)
  drawDim(doc, L.dimensions, [-15, 0], [-15, wid], [-15, 0], 90, `${wid}`);
  drawInfo(doc, input, wid);
  return doc.toString();
}
