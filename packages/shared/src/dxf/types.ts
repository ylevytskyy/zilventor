/** One DXF group-code / value record. */
export type DxfPair = { readonly code: number; readonly value: string };

export type DxfEntity =
  | { type: 'LINE'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'CIRCLE'; layer: string; cx: number; cy: number; r: number };

export type ParsedDxf = {
  entities: DxfEntity[];
  blocks: Record<string, DxfEntity[]>;
  header: Record<string, string>;
};
