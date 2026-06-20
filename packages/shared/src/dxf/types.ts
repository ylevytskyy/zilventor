/** One DXF group-code / value record. */
export type DxfPair = { readonly code: number; readonly value: string };

export type DxfEntity =
  | { type: 'LINE'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'CIRCLE'; layer: string; cx: number; cy: number; r: number }
  | { type: 'ARC'; layer: string; cx: number; cy: number; r: number; startAngle: number; endAngle: number }
  | { type: 'TEXT'; layer: string; x: number; y: number; height: number; value: string; rotation: number }
  | { type: 'MTEXT'; layer: string; x: number; y: number; height: number; value: string; rotation: number }
  | { type: 'LWPOLYLINE'; layer: string; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }
  | { type: 'POLYLINE'; layer: string; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }
  | { type: 'INSERT'; layer: string; name: string; x: number; y: number; xscale: number; yscale: number; rotation: number }
  | { type: 'SPLINE'; layer: string; degree: number; closed: boolean; controlPoints: Array<{ x: number; y: number }> }
  | { type: 'ELLIPSE'; layer: string; cx: number; cy: number; majorX: number; majorY: number; ratio: number; startParam: number; endParam: number };

export type ParsedDxf = {
  entities: DxfEntity[];
  blocks: Record<string, DxfEntity[]>;
  header: Record<string, string>;
};
