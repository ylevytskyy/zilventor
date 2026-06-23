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
  // L dimension (horizontal, below the panel)
  drawDim(doc, L.dimensions, [0, -15], [len, -15], [0, -15], 0, `${len}`);
  // W dimension (vertical, left of the panel)
  drawDim(doc, L.dimensions, [-15, 0], [-15, wid], [-15, 0], 90, `${wid}`);
  drawInfo(doc, input, wid);
  return doc.toString();
}
