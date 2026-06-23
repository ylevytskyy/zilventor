// packages/app/src/drawing/dxfWriter.ts
/**
 * AutoCAD R2000 (AC1015) ASCII DXF builder.
 * All entity emitters accept already-transformed, already-Y-flipped coordinates.
 * Caller (renderDrawingDxf) owns the coordinate transform.
 */

export type DxfDocument = {
  /** Emit a LINE entity. Optional aci (AutoCAD Color Index, group 62) overrides layer color. */
  line(layer: string, x1: number, y1: number, x2: number, y2: number, aci?: number): void;
  /** Emit a POLYLINE/VERTEX[]/SEQEND entity sequence (R12 — not LWPOLYLINE). */
  polyline(layer: string, points: ReadonlyArray<readonly [number, number]>): void;
  /** Emit a CIRCLE entity. */
  circle(layer: string, cx: number, cy: number, r: number): void;
  /** Emit a native ARC entity. Angles in degrees (DXF group 50/51 convention). */
  arc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): void;
  /** Emit a native ELLIPSE. majorX/majorY are the major-axis endpoint RELATIVE to center; ratio = minor/major; params in radians. */
  ellipse(layer: string, cx: number, cy: number, majorX: number, majorY: number, ratio: number, startParam?: number, endParam?: number): void;
  /** Emit a TEXT entity. rotation defaults to 0. */
  text(layer: string, x: number, y: number, height: number, value: string, rotation?: number): void;
  /** Capture all geometry emitted inside `build` into an anonymous BLOCK; returns its *D name. */
  block(build: () => void): string;
  /** Emit a native DIMENSION entity (R12). Coordinates are already transformed/Y-flipped. */
  dimension(opts: {
    layer: string;
    blockName: string;
    dimStyle: string;
    dimType: number;                                  // group 70 value (flags pre-baked)
    defPoint: readonly [number, number];              // group 10/20
    textMid: readonly [number, number];               // group 11/21
    text: string;                                     // group 1
    rotation?: number;                                // group 50 (rotated linear only)
    extraPoints?: ReadonlyArray<readonly [number, number, number]>; // [code, x, y] → code/code+10/code+20
  }): void;
  /** Emit a native SPLINE from control points. Generates a clamped uniform knot vector. */
  spline(layer: string, controlPoints: ReadonlyArray<{ x: number; y: number }>, degree: number, closed: boolean): void;
  /** Emit a native LWPOLYLINE. Optional per-vertex bulge for arc segments. */
  lwpolyline(layer: string, points: ReadonlyArray<{ x: number; y: number; bulge?: number }>, closed: boolean): void;
  /** Serialize to DXF string. */
  toString(): string;
};

const LAYERS = [
  'VISIBLE', 'HIDDEN', 'SECTION-HATCH', 'SECTION-LINE',
  'DETAIL', 'DIMENSIONS', 'ANNOTATIONS', 'HOLE-TABLE', 'TITLE',
] as const;

function fmt(n: number): string {
  // DXF R12 coords: up to 6 decimal places, no trailing zeros beyond 3.
  // Guard against non-finite values and negative-zero — DXF parsers reject 'NaN'/'Infinity'.
  if (!Number.isFinite(n) || Object.is(n, -0)) return '0.0000';
  return n.toFixed(4);
}

// Minimal ACI palette (index → RGB). Enough to differentiate common furniture material colors.
const ACI_PALETTE: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255],
  [5, 0, 0, 255], [6, 255, 0, 255], [7, 255, 255, 255], [8, 128, 128, 128],
  [9, 192, 192, 192], [30, 255, 127, 0], [40, 128, 64, 0], [250, 51, 51, 51],
];

/**
 * Convert a CSS hex color to the nearest AutoCAD Color Index (ACI).
 * Near-black → 7 (renders as default black/white, matching layer color).
 * Invalid input → 7.
 */
export function hexToAci(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 7;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // near-black → 7 (renders as default black/white, matching layer color)
  if (r < 24 && g < 24 && b < 24) return 7;
  let best = 7, bestD = Infinity;
  for (const [aci, pr, pg, pb] of ACI_PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = aci; }
  }
  return best;
}

export function createDxfDocument(): DxfDocument {
  // ── Handle allocator (AC1015 requires handles on all named records) ───────
  // Starts at 0x100 so low handles are reserved for well-known table records.
  let handleSeq = 0x100;
  const nextHandle = (): string => (handleSeq++).toString(16).toUpperCase();

  // HEADER is assembled lazily in toString() so $HANDSEED reflects all handles.
  const tables: string[] = [];

  // Allocate stable handles for *Model_Space and *Paper_Space BLOCK_RECORDs now
  // (before tables are built) so they land before entity handles and remain
  // stable — Task 3 consumes modelSpaceHandle as the entity owner (group 330).
  const modelSpaceHandle = nextHandle();
  const paperSpaceHandle = nextHandle();

  // ── TABLES section (strict AC1015 set with handles) ───────────────────────
  tables.push('  0', 'SECTION', '  2', 'TABLES');

  // VPORT (one *Active viewport)
  tables.push('  0', 'TABLE', '  2', 'VPORT', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'VPORT', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbViewportTableRecord', '  2', '*Active', ' 70', '     0');
  tables.push('  0', 'ENDTAB');

  // LTYPE — define CONTINUOUS and DASHED
  tables.push('  0', 'TABLE', '  2', 'LTYPE', '  5', nextHandle(), ' 70', '     2');
  tables.push('  0', 'LTYPE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord', '  2', 'CONTINUOUS', ' 70', '     0', '  3', 'Solid line', ' 72', '    65', ' 73', '     0', ' 40', '0.0');
  tables.push('  0', 'LTYPE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord', '  2', 'DASHED', ' 70', '     0', '  3', 'Dashed line', ' 72', '    65', ' 73', '     2', ' 40', '6.0', ' 49', '4.0', ' 49', '-2.0');
  tables.push('  0', 'ENDTAB');

  // LAYER
  tables.push('  0', 'TABLE', '  2', 'LAYER', '  5', nextHandle(), ' 70', `     ${LAYERS.length}`);
  for (const name of LAYERS) {
    const ltype = name === 'HIDDEN' ? 'DASHED' : 'CONTINUOUS';
    const color = name === 'HIDDEN' ? '     3' : '     7';
    tables.push('  0', 'LAYER', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '  2', name, ' 70', '     0', ' 62', color, '  6', ltype);
  }
  tables.push('  0', 'ENDTAB');

  // STYLE (STANDARD)
  tables.push('  0', 'TABLE', '  2', 'STYLE', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'STYLE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord', '  2', 'STANDARD', ' 70', '     0', ' 40', '0.0', ' 41', '1.0', ' 50', '0.0', ' 71', '     0', ' 42', '2.5', '  3', 'txt', '  4', '');
  tables.push('  0', 'ENDTAB');

  // VIEW (empty)
  tables.push('  0', 'TABLE', '  2', 'VIEW', '  5', nextHandle(), ' 70', '     0', '  0', 'ENDTAB');
  // UCS (empty)
  tables.push('  0', 'TABLE', '  2', 'UCS', '  5', nextHandle(), ' 70', '     0', '  0', 'ENDTAB');

  // APPID (ACAD)
  tables.push('  0', 'TABLE', '  2', 'APPID', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'APPID', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '  2', 'ACAD', ' 70', '     0');
  tables.push('  0', 'ENDTAB');

  // DIMSTYLE — one shared STANDARD style (drives native DIMENSION regen)
  // NOTE: DIMSTYLE records use group 105 for their handle (not 5) per DXF spec.
  tables.push('  0', 'TABLE', '  2', 'DIMSTYLE', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'DIMSTYLE', '105', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '  2', 'STANDARD', ' 70', '     0', '140', '3.5', ' 41', '2.5', '147', '0.625', ' 77', '     1', ' 73', '     0', ' 74', '     0');
  tables.push('  0', 'ENDTAB');

  // BLOCK_RECORD (*Model_Space, *Paper_Space)
  tables.push('  0', 'TABLE', '  2', 'BLOCK_RECORD', '  5', nextHandle(), ' 70', '     2');
  tables.push('  0', 'BLOCK_RECORD', '  5', modelSpaceHandle, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', '*Model_Space');
  tables.push('  0', 'BLOCK_RECORD', '  5', paperSpaceHandle, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', '*Paper_Space');
  tables.push('  0', 'ENDTAB');

  tables.push('  0', 'ENDSEC');

  // ── BLOCKS section accumulator (block definitions appended by block()) ──
  const blockDefs: string[] = [];

  // Internal entities accumulator — populated by emitters
  const ents: string[] = [];
  // Current emission target: ENTITIES by default, redirected into a block during block().
  let sink: string[] = ents;
  let anonCounter = 0;
  let currentOwner = modelSpaceHandle; // entities reference their owning block record

  return {
    line(layer, x1, y1, x2, y2, aci) {
      sink.push(
        '  0', 'LINE',
        '  5', nextHandle(),
        '330', currentOwner,
        '100', 'AcDbEntity',
        '  8', layer,
        ...(aci !== undefined ? [' 62', String(aci)] : []),
        '100', 'AcDbLine',
        ' 10', fmt(x1), ' 20', fmt(y1), ' 30', '0.0',
        ' 11', fmt(x2), ' 21', fmt(y2), ' 31', '0.0',
      );
    },

    polyline(layer, points) {
      if (points.length < 2) return;
      sink.push('  0', 'POLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDb2dPolyline', ' 66', '     1', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 70', '     0');
      for (const [x, y] of points) {
        sink.push('  0', 'VERTEX', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbVertex', '100', 'AcDb2dVertex', ' 10', fmt(x), ' 20', fmt(y), ' 30', '0.0');
      }
      sink.push('  0', 'SEQEND', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer);
    },

    circle(layer, cx, cy, r) {
      sink.push('  0', 'CIRCLE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbCircle', ' 10', fmt(cx), ' 20', fmt(cy), ' 30', '0.0', ' 40', fmt(r));
    },

    arc(layer, cx, cy, r, startDeg, endDeg) {
      sink.push('  0', 'ARC', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbCircle', ' 10', fmt(cx), ' 20', fmt(cy), ' 30', '0.0', ' 40', fmt(r), '100', 'AcDbArc', ' 50', fmt(startDeg), ' 51', fmt(endDeg));
    },

    ellipse(layer, cx, cy, majorX, majorY, ratio, startParam = 0, endParam = 2 * Math.PI) {
      sink.push('  0', 'ELLIPSE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbEllipse', ' 10', fmt(cx), ' 20', fmt(cy), ' 30', '0.0', ' 11', fmt(majorX), ' 21', fmt(majorY), ' 31', '0.0', ' 40', fmt(ratio), ' 41', fmt(startParam), ' 42', fmt(endParam));
    },

    text(layer, x, y, height, value, rotation = 0) {
      sink.push('  0', 'TEXT', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbText', ' 10', fmt(x), ' 20', fmt(y), ' 30', '0.0', ' 40', fmt(height), '  1', value, ' 50', fmt(rotation), '100', 'AcDbText', ' 73', '     0');
    },

    block(build) {
      const name = `*D${++anonCounter}`;
      const prev = sink;
      const body: string[] = [];
      sink = body;
      try { build(); } finally { sink = prev; }
      blockDefs.push(
        '  0', 'BLOCK',
        '  8', '0',
        '  2', name,
        ' 70', '     1',   // anonymous block flag
        ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
        '  3', name,
        ...body,
        '  0', 'ENDBLK',
        '  8', '0',
      );
      return name;
    },

    dimension(opts) {
      const pad = (n: number): string => {
        const s = String(n);
        return s.length >= 3 ? s : ' '.repeat(3 - s.length) + s;
      };
      ents.push(
        '  0', 'DIMENSION',
        '  5', nextHandle(),
        '330', modelSpaceHandle,
        '100', 'AcDbEntity',
        '  8', opts.layer,
        '100', 'AcDbDimension',
        '  2', opts.blockName,
        ' 10', fmt(opts.defPoint[0]), ' 20', fmt(opts.defPoint[1]), ' 30', '0.0',
        ' 11', fmt(opts.textMid[0]), ' 21', fmt(opts.textMid[1]), ' 31', '0.0',
        ' 70', `     ${opts.dimType}`,
        '  1', opts.text,
        '  3', opts.dimStyle,
      );
      if (opts.rotation !== undefined) {
        ents.push('100', 'AcDbAlignedDimension', ' 50', fmt(opts.rotation));
      } else {
        ents.push('100', 'AcDbAlignedDimension');
      }
      for (const [code, x, y] of opts.extraPoints ?? []) {
        ents.push(
          pad(code), fmt(x),
          pad(code + 10), fmt(y),
          pad(code + 20), '0.0',
        );
      }
    },

    lwpolyline(layer, points, closed) {
      if (points.length < 2) return;
      sink.push('  0', 'LWPOLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbPolyline',
        ' 90', `     ${points.length}`, ' 70', `     ${closed ? 1 : 0}`);
      for (const p of points) {
        sink.push(' 10', fmt(p.x), ' 20', fmt(p.y));
        if (p.bulge !== undefined && p.bulge !== 0) sink.push(' 42', fmt(p.bulge));
      }
    },

    spline(layer, controlPoints, degree, closed) {
      const n = controlPoints.length;
      const deg = Math.min(degree, Math.max(1, n - 1));
      // clamped uniform knot vector: (deg+1) zeros, ascending interior, (deg+1) of max
      const knotCount = n + deg + 1;
      const interior = knotCount - 2 * (deg + 1);
      const knots: number[] = [];
      for (let i = 0; i <= deg; i++) knots.push(0);
      for (let i = 1; i <= interior; i++) knots.push(i);
      for (let i = 0; i <= deg; i++) knots.push(interior + 1);
      const flags = (closed ? 1 : 0) | 8; // 8 = planar
      sink.push('  0', 'SPLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbSpline',
        ' 70', `     ${flags}`, ' 71', `     ${deg}`, ' 72', `     ${knots.length}`, ' 73', `     ${n}`);
      for (const k of knots) sink.push(' 40', fmt(k));
      for (const p of controlPoints) sink.push(' 10', fmt(p.x), ' 20', fmt(p.y), ' 30', '0.0');
    },

    toString() {
      const blockSection = [
        '  0', 'SECTION', '  2', 'BLOCKS',
        '  0', 'BLOCK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockBegin', '  2', '*Model_Space', ' 70', '     0', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', '  3', '*Model_Space', '  1', '',
        '  0', 'ENDBLK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockEnd',
        '  0', 'BLOCK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockBegin', '  2', '*Paper_Space', ' 70', '     0', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', '  3', '*Paper_Space', '  1', '',
        '  0', 'ENDBLK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockEnd',
        ...blockDefs,
        '  0', 'ENDSEC',
      ];
      const entSection = [
        '  0', 'SECTION', '  2', 'ENTITIES',
        ...ents,
        '  0', 'ENDSEC',
      ];

      // Allocate the OBJECTS dictionary handle BEFORE reading handleSeq for
      // $HANDSEED, so that the seed value exceeds ALL allocated handles.
      const dictHandle = nextHandle();
      const objectsSection = [
        '  0', 'SECTION', '  2', 'OBJECTS',
        '  0', 'DICTIONARY', '  5', dictHandle, '100', 'AcDbDictionary', ' 70', '     0',
        '  0', 'ENDSEC',
      ];

      // Assemble HEADER last so $HANDSEED reflects every handle allocated above.
      const headerSection = [
        '  0', 'SECTION', '  2', 'HEADER',
        '  9', '$ACADVER', '  1', 'AC1015',
        '  9', '$HANDSEED', '  5', handleSeq.toString(16).toUpperCase(),
        '  0', 'ENDSEC',
      ];
      const classesSection = ['  0', 'SECTION', '  2', 'CLASSES', '  0', 'ENDSEC'];

      return [
        ...headerSection,
        ...classesSection,
        ...tables,
        ...blockSection,
        ...entSection,
        ...objectsSection,
        '  0', 'EOF',
      ].join('\n') + '\n';
    },
  };
}
