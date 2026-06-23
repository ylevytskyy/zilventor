/** One DXF group-code / value record. */
export type DxfPair = { readonly code: number; readonly value: string };

export type DxfExtrusion = { x: number; y: number; z: number };

/** Fields present on every DXF entity variant (optional for backward-compat). */
type DxfEntityCommon = { layer: string; color?: number; linetype?: string };

export type DxfEntity =
  | (DxfEntityCommon & { type: 'LINE'; x1: number; y1: number; x2: number; y2: number })
  | (DxfEntityCommon & { type: 'CIRCLE'; cx: number; cy: number; r: number; extrusion?: DxfExtrusion })
  | (DxfEntityCommon & { type: 'ARC'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; extrusion?: DxfExtrusion })
  | (DxfEntityCommon & { type: 'TEXT'; x: number; y: number; height: number; value: string; rotation: number })
  | (DxfEntityCommon & { type: 'MTEXT'; x: number; y: number; height: number; value: string; rotation: number })
  | (DxfEntityCommon & { type: 'LWPOLYLINE'; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }>; extrusion?: DxfExtrusion })
  | (DxfEntityCommon & { type: 'POLYLINE'; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }>; extrusion?: DxfExtrusion })
  | (DxfEntityCommon & { type: 'INSERT'; name: string; x: number; y: number; xscale: number; yscale: number; rotation: number; columns: number; rows: number; colSpacing: number; rowSpacing: number })
  | (DxfEntityCommon & { type: 'SPLINE'; degree: number; closed: boolean; controlPoints: Array<{ x: number; y: number }>; fitPoints: Array<{ x: number; y: number }>; knots: number[]; weights: number[] })
  | (DxfEntityCommon & { type: 'ELLIPSE'; cx: number; cy: number; majorX: number; majorY: number; ratio: number; startParam: number; endParam: number; extrusion?: DxfExtrusion })
  | (DxfEntityCommon & { type: 'POINT'; x: number; y: number; extrusion?: DxfExtrusion })
  | (DxfEntityCommon & { type: 'SOLID'; corners: ReadonlyArray<{ x: number; y: number }>; extrusion?: DxfExtrusion })
  | (DxfEntityCommon & { type: 'LEADER'; vertices: ReadonlyArray<{ x: number; y: number }> })
  | (DxfEntityCommon & { type: '3DFACE'; corners: ReadonlyArray<{ x: number; y: number; z: number }> })
  | (DxfEntityCommon & { type: 'RAY'; x: number; y: number; dx: number; dy: number })
  | (DxfEntityCommon & { type: 'XLINE'; x: number; y: number; dx: number; dy: number })
  | (DxfEntityCommon & { type: 'DIMENSION'; block?: string; textOverride: string; measurement: number; textMidX: number; textMidY: number })
  | (DxfEntityCommon & { type: 'MLEADER';
      leaderLines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
      text?: { value: string; x: number; y: number; height: number; rotation: number } })
  | (DxfEntityCommon & { type: 'HATCH'; loops: HatchLoop[]; extrusion?: DxfExtrusion });

export type HatchEdge =
  | { kind: 'line';    x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arc';     cx: number; cy: number; r: number;
                       startAngle: number; endAngle: number; ccw: boolean }       // DEGREES
  | { kind: 'ellipse'; cx: number; cy: number; majorX: number; majorY: number;
                       ratio: number; startAngle: number; endAngle: number; ccw: boolean } // DEGREES
  | { kind: 'spline';  degree: number; closed: boolean;
                       controlPoints: Array<{ x: number; y: number }>; knots: number[]; weights?: number[] };

export type HatchLoop =
  | { kind: 'polyline'; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }
  | { kind: 'edges';    edges: HatchEdge[] };

export type DxfLayer = { name: string; color: number; linetype: string; flags: number };

export type ParsedDxf = {
  entities: DxfEntity[];
  blocks: Record<string, DxfEntity[]>;
  header: Record<string, string>;
  layers: Record<string, DxfLayer>;
  blockBasePoints: Record<string, { x: number; y: number }>;
};
