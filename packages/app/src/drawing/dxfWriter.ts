// packages/app/src/drawing/dxfWriter.ts
/**
 * AutoCAD R2000 (AC1015) ASCII DXF builder.
 * All entity emitters accept already-transformed, already-Y-flipped coordinates.
 * Caller (renderDrawingDxf) owns the coordinate transform.
 */

/**
 * Extended entity data (DXF groups 1000-1071), attached under the `ZILVENTOR` APPID.
 * 1000 = string, 1040 = real (double), 1070 = 16-bit integer.
 */
export type XdataItem =
  | { code: 1000; value: string }
  | { code: 1040; value: number }
  | { code: 1070; value: number };

/** A 3D point [x, y, z], used by the polyface-mesh / 3D-line emitters. */
export type Vec3 = readonly [number, number, number];

export type DxfDocument = {
  /** Emit a LINE entity. Optional aci (AutoCAD Color Index, group 62) overrides layer color. */
  line(layer: string, x1: number, y1: number, x2: number, y2: number, aci?: number): void;
  /** Emit a LINE entity with independent Z on each endpoint (the 2D `line()` always emits Z=0). */
  line3d(layer: string, p1: Vec3, p2: Vec3): void;
  /** Emit a POLYLINE/VERTEX[]/SEQEND entity sequence (R12 — not LWPOLYLINE). */
  polyline(layer: string, points: ReadonlyArray<readonly [number, number]>): void;
  /**
   * Emit a legacy closed/open 3D POLYLINE (AcDb3dPolyline, flags 70 = 9 closed / 8 open) with
   * VERTEX entities (AcDb3dPolylineVertex, flags 70=32) — the ViyarPro/ABF cutting-line dialect
   * (see .vp-native/variants/f4.dxf). `closed` repeats the first point as a final vertex
   * (N+1 total) — required by the accepted dialect, not implied by the closed flag alone.
   */
  polyline3d(layer: string, points: ReadonlyArray<readonly [number, number]>, closed: boolean): void;
  /**
   * Same AcDb3dPolyline/AcDb3dPolylineVertex structure and closed-repeats-first-point
   * convention as `polyline3d`, but each vertex carries its OWN Z (polyline3d always
   * emits Z=0) — used by the ViyarPro/ABF "side-drill" dialect for an edge bore's
   * depth-profile rectangle (R-DSIDE), which genuinely needs 3D vertices.
   */
  polyline3dPoints(layer: string, points: ReadonlyArray<Vec3>, closed: boolean): void;
  /**
   * Emit a single-quad polyface mesh (AcDbPolyFaceMesh, POLYLINE flags 70=64, 71=4 vertices,
   * 72=2 faces): 4 position VERTEX + 2 triangular face-record VERTEX (indices -1/2/3 and
   * -2/1/4, coords 0,0,0) + SEQEND. ALL 6 VERTEX entities carry flags 70=192 (the golden
   * reference's value — not the AutoCAD-doc "128 alone" convention). Used for the ViyarPro/ABF
   * "solid representation" requirement: 6 of these (one per box face) per panel.
   */
  polyfaceMesh(layer: string, quad: readonly [Vec3, Vec3, Vec3, Vec3]): void;
  /**
   * Emit a CIRCLE entity. Optional xdata (ZILVENTOR APPID) emitted last, per DXF spec.
   * Optional `extrusion` (group 210/220/230) tilts the circle's plane — used by the
   * ViyarPro/ABF "side-drill" dialect to encode an edge bore's drill axis (R-DSIDE).
   * Omitting it (the default) reproduces the exact prior CIRCLE output byte-for-byte.
   */
  circle(layer: string, cx: number, cy: number, r: number, xdata?: readonly XdataItem[], extrusion?: Vec3): void;
  /** Emit a native ARC entity. Angles in degrees (DXF group 50/51 convention). */
  arc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): void;
  /** Emit a native ELLIPSE. majorX/majorY are the major-axis endpoint RELATIVE to center; ratio = minor/major; params in radians. */
  ellipse(layer: string, cx: number, cy: number, majorX: number, majorY: number, ratio: number, startParam?: number, endParam?: number): void;
  /** Emit a TEXT entity. rotation defaults to 0. */
  text(layer: string, x: number, y: number, height: number, value: string, rotation?: number): void;
  /** Capture all geometry emitted inside `build` into an anonymous BLOCK; returns its *D name. */
  block(build: () => void): string;
  /**
   * Capture all geometry emitted inside `build` into a NAMED BLOCK (flag 70=0), with its own
   * BLOCK_RECORD table entry. Entities emitted inside `build` (including nested insert() calls)
   * are owned (group 330) by this block's BLOCK_RECORD handle. Returns `name` unchanged.
   */
  namedBlock(name: string, build: () => void): string;
  /**
   * Emit an INSERT entity referencing `blockName`, optionally followed by one ATTRIB per entry
   * in `attribs` and a terminating SEQEND (AcDb group 66=1 "attributes follow" flag set only
   * when attribs is non-empty). Usable both in the top-level ENTITIES stream and inside a
   * `namedBlock()` build callback (nested INSERT).
   */
  insert(
    blockName: string,
    x: number,
    y: number,
    attribs?: ReadonlyArray<{ tag: string; value: string }>,
    /** Opt-in Z coordinate (group 30, applied to both INSERT and every ATTRIB) and layer
     *  (group 8, applied to INSERT and ATTRIB — SEQEND stays layer '0' regardless). Omitting
     *  either reproduces the exact prior output (Z literal '0.0', layer '0'). */
    opts?: { z?: number; layer?: string },
  ): void;
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
  /** Emit a native LWPOLYLINE. Optional per-vertex bulge for arc segments. Optional xdata (ZILVENTOR APPID) emitted once, after all vertices. */
  lwpolyline(layer: string, points: ReadonlyArray<{ x: number; y: number; bulge?: number }>, closed: boolean, xdata?: readonly XdataItem[]): void;
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

/** Append XDATA groups (1001 ZILVENTOR + typed codes) to `sink`. No-op when `xdata` is absent/empty. */
function emitXdata(sink: string[], xdata?: readonly XdataItem[]): void {
  if (!xdata || xdata.length === 0) return;
  sink.push('1001', 'ZILVENTOR');
  for (const item of xdata) {
    if (item.code === 1070) sink.push('1070', String(Math.trunc(item.value)));
    else if (item.code === 1040) sink.push('1040', fmt(item.value));
    else sink.push('1000', item.value);
  }
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

/**
 * Opt-in HEADER overrides. Omitting a field (the default) reproduces the exact prior
 * HEADER output for that field byte-for-byte.
 */
export type CreateDxfDocumentOpts = {
  /** $ACADVER. Defaults to 'AC1015' (prior behavior). */
  acadVersion?: 'AC1015' | 'AC1021';
  /** $INSUNITS (group 70 integer), e.g. 4 = Millimeters. Omitted by default. */
  insunits?: number;
  /** $MEASUREMENT (group 70 integer), e.g. 1 = Metric. Omitted by default. */
  measurement?: number;
  /** $EXTMIN/$EXTMAX (real document extents). Omitted by default (no sentinel emitted). */
  bbox?: { minX: number; minY: number; maxX: number; maxY: number };
  /**
   * Opt-in TABLES/OBJECTS richness proven necessary (empirically, via live viyar.pro upload)
   * to clear the server's InvalidScaleError: adds DimStyle1 + Dimensions DIMSTYLE entries (3
   * total incl. STANDARD), a Tahoma STYLE entry (2 total incl. STANDARD), and an OBJECTS
   * section whose root dictionary declares ACAD_SECTIONVIEWSTYLE / ACDB_RECOMPOSE_DATA /
   * AcDbVariableDictionary (minimal empty DICTIONARY objects — presence is what's checked).
   * Also emits $DIMALTF=25.4 in HEADER — live server debugging isolated this as the actual
   * InvalidScaleError trigger. See .vp-native/variants/f4.dxf. Omitted/false (the default)
   * reproduces the exact prior HEADER/TABLES/OBJECTS output byte-for-byte.
   */
  sketchupCompat?: boolean;
};

/**
 * @param extraLayers Additional LAYER table records to declare beyond the fixed
 * `LAYERS` set, e.g. dynamic per-diameter bore layers for a combined multi-unit
 * document. Deduped against `LAYERS` and against each other; omitting it (the
 * default) reproduces the exact prior LAYER table byte-for-byte.
 * @param opts Opt-in HEADER overrides — see `CreateDxfDocumentOpts`. Omitting it (the
 * default) reproduces the exact prior HEADER output byte-for-byte.
 */
export function createDxfDocument(extraLayers: readonly string[] = [], opts: CreateDxfDocumentOpts = {}): DxfDocument {
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

  // LAYER (fixed set + any deduped extraLayers requested by the caller)
  const dedupedExtra = Array.from(new Set(extraLayers)).filter((name) => !(LAYERS as readonly string[]).includes(name));
  const allLayers: readonly string[] = [...LAYERS, ...dedupedExtra];
  tables.push('  0', 'TABLE', '  2', 'LAYER', '  5', nextHandle(), ' 70', `     ${allLayers.length}`);
  for (const name of allLayers) {
    const ltype = name === 'HIDDEN' ? 'DASHED' : 'CONTINUOUS';
    const color = name === 'HIDDEN' ? '     3' : '     7';
    tables.push('  0', 'LAYER', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '  2', name, ' 70', '     0', ' 62', color, '  6', ltype);
  }
  tables.push('  0', 'ENDTAB');

  // STYLE (STANDARD [+ Tahoma under sketchupCompat])
  tables.push('  0', 'TABLE', '  2', 'STYLE', '  5', nextHandle(), ' 70', `     ${opts.sketchupCompat ? 2 : 1}`);
  tables.push('  0', 'STYLE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord', '  2', 'STANDARD', ' 70', '     0', ' 40', '0.0', ' 41', '1.0', ' 50', '0.0', ' 71', '     0', ' 42', '2.5', '  3', 'txt', '  4', '');
  if (opts.sketchupCompat) {
    tables.push('  0', 'STYLE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord', '  2', 'Tahoma', ' 70', '     0', ' 40', '0.0', ' 41', '1.0', ' 50', '0.0', ' 71', '     0', ' 42', '0.2', '  3', '', '  4', '');
  }
  tables.push('  0', 'ENDTAB');

  // VIEW (empty)
  tables.push('  0', 'TABLE', '  2', 'VIEW', '  5', nextHandle(), ' 70', '     0', '  0', 'ENDTAB');
  // UCS (empty)
  tables.push('  0', 'TABLE', '  2', 'UCS', '  5', nextHandle(), ' 70', '     0', '  0', 'ENDTAB');

  // APPID (ACAD + ZILVENTOR — the latter carries XDATA emitted via circle()/lwpolyline() etc.)
  tables.push('  0', 'TABLE', '  2', 'APPID', '  5', nextHandle(), ' 70', '     2');
  tables.push('  0', 'APPID', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '  2', 'ACAD', ' 70', '     0');
  tables.push('  0', 'APPID', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '  2', 'ZILVENTOR', ' 70', '     0');
  tables.push('  0', 'ENDTAB');

  // DIMSTYLE — one shared STANDARD style (drives native DIMENSION regen)
  // [+ DimStyle1 + Dimensions under sketchupCompat — see CreateDxfDocumentOpts.sketchupCompat]
  // NOTE: DIMSTYLE records use group 105 for their handle (not 5) per DXF spec.
  tables.push('  0', 'TABLE', '  2', 'DIMSTYLE', '  5', nextHandle(), ' 70', `     ${opts.sketchupCompat ? 3 : 1}`);
  tables.push('  0', 'DIMSTYLE', '105', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '  2', 'STANDARD', ' 70', '     0', '140', '3.5', ' 41', '2.5', '147', '0.625', ' 77', '     1', ' 73', '     0', ' 74', '     0');
  if (opts.sketchupCompat) {
    tables.push('  0', 'DIMSTYLE', '105', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '  2', 'DimStyle1', ' 70', '     0');
    tables.push('  0', 'DIMSTYLE', '105', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '  2', 'Dimensions', ' 70', '     0');
  }
  tables.push('  0', 'ENDTAB');

  // BLOCK_RECORD (*Model_Space, *Paper_Space [+ any namedBlock() records, appended lazily —
  // see `namedBlockRecords` below]). The TABLE row's own handle is reserved now (same relative
  // position in the handle sequence as before) but the row itself, and the closing ENDTAB/ENDSEC
  // for the whole TABLES section, are assembled lazily in toString() so namedBlock() calls made
  // after createDxfDocument() returns can still contribute BLOCK_RECORD entries.
  const blockRecordTableHandle = nextHandle();
  const namedBlockRecords: string[] = [];
  let namedBlockCount = 0;

  // ── BLOCKS section accumulator (block definitions appended by block()/namedBlock()) ──
  const blockDefs: string[] = [];

  // Internal entities accumulator — populated by emitters
  const ents: string[] = [];
  // Current emission target: ENTITIES by default, redirected into a block during block().
  let sink: string[] = ents;
  let anonCounter = 0;
  let currentOwner = modelSpaceHandle; // entities reference their owning block record

  // Lazily-allocated handle for INSERT/SEQEND's group-347 material-object reference. Allocated
  // on first insert() call (not eagerly) so documents that never call insert() keep an identical
  // handle sequence — and thus byte-identical output — to before this feature existed.
  let materialHandleCache: string | undefined;
  const materialHandle = (): string => {
    if (materialHandleCache === undefined) materialHandleCache = nextHandle();
    return materialHandleCache;
  };

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

    line3d(layer, [x1, y1, z1], [x2, y2, z2]) {
      sink.push(
        '  0', 'LINE',
        '  5', nextHandle(),
        '330', currentOwner,
        '100', 'AcDbEntity',
        '  8', layer,
        '100', 'AcDbLine',
        ' 10', fmt(x1), ' 20', fmt(y1), ' 30', fmt(z1),
        ' 11', fmt(x2), ' 21', fmt(y2), ' 31', fmt(z2),
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

    polyline3d(layer, points, closed) {
      if (points.length < 2) return;
      sink.push('  0', 'POLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDb3dPolyline', ' 66', '     1', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 70', `     ${closed ? 9 : 8}`);
      const emitVertex = (x: number, y: number): void => {
        sink.push('  0', 'VERTEX', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbVertex', '100', 'AcDb3dPolylineVertex', ' 10', fmt(x), ' 20', fmt(y), ' 30', '0.0', ' 70', '    32');
      };
      for (const [x, y] of points) emitVertex(x, y);
      if (closed) emitVertex(points[0]![0], points[0]![1]);
      sink.push('  0', 'SEQEND', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer);
    },

    polyline3dPoints(layer, points, closed) {
      if (points.length < 2) return;
      sink.push('  0', 'POLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDb3dPolyline', ' 66', '     1', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 70', `     ${closed ? 9 : 8}`);
      const emitVertex = ([x, y, z]: Vec3): void => {
        sink.push('  0', 'VERTEX', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbVertex', '100', 'AcDb3dPolylineVertex', ' 10', fmt(x), ' 20', fmt(y), ' 30', fmt(z), ' 70', '    32');
      };
      for (const p of points) emitVertex(p);
      if (closed) emitVertex(points[0]!);
      sink.push('  0', 'SEQEND', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer);
    },

    polyfaceMesh(layer, quad) {
      sink.push('  0', 'POLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbPolyFaceMesh', ' 66', '     1', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 70', '    64', ' 71', '     4', ' 72', '     2');
      for (const [x, y, z] of quad) {
        sink.push('  0', 'VERTEX', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbVertex', '100', 'AcDbPolyFaceMeshVertex', ' 10', fmt(x), ' 20', fmt(y), ' 30', fmt(z), ' 70', '   192');
      }
      const faceRecord = (a: number, b: number, c: number): void => {
        sink.push('  0', 'VERTEX', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbVertex', '100', 'AcDbPolyFaceMeshVertex', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 70', '   192', ' 71', `     ${a}`, ' 72', `     ${b}`, ' 73', `     ${c}`);
      };
      faceRecord(-1, 2, 3);
      faceRecord(-2, 1, 4);
      sink.push('  0', 'SEQEND', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer);
    },

    circle(layer, cx, cy, r, xdata, extrusion) {
      sink.push('  0', 'CIRCLE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbCircle', ' 10', fmt(cx), ' 20', fmt(cy), ' 30', '0.0', ' 40', fmt(r));
      if (extrusion) sink.push('210', fmt(extrusion[0]), '220', fmt(extrusion[1]), '230', fmt(extrusion[2]));
      emitXdata(sink, xdata);
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

    namedBlock(name, build) {
      const blockRecordHandle = nextHandle();
      namedBlockCount++;
      namedBlockRecords.push(
        '  0', 'BLOCK_RECORD',
        '  5', blockRecordHandle,
        '100', 'AcDbSymbolTableRecord',
        '100', 'AcDbBlockTableRecord',
        '  2', name,
      );
      const blockHandle = nextHandle();
      const endblkHandle = nextHandle();
      const prevSink = sink;
      const prevOwner = currentOwner;
      const body: string[] = [];
      sink = body;
      currentOwner = blockRecordHandle;
      try { build(); } finally { sink = prevSink; currentOwner = prevOwner; }
      blockDefs.push(
        '  0', 'BLOCK',
        '  5', blockHandle,
        '330', blockRecordHandle,
        '100', 'AcDbEntity',
        '  8', '0',
        '100', 'AcDbBlockBegin',
        '  2', name,
        ' 70', '     0',   // named (non-anonymous) block flag
        ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
        '  3', name,
        '  1', '',
        ...body,
        '  0', 'ENDBLK',
        '  5', endblkHandle,
        '330', blockRecordHandle,
        '100', 'AcDbEntity',
        '  8', '0',
        '100', 'AcDbBlockEnd',
      );
      return name;
    },

    insert(blockName, x, y, attribs, opts) {
      const insertHandle = nextHandle();
      const hasAttribs = attribs !== undefined && attribs.length > 0;
      const layer = opts?.layer ?? '0';
      const z = opts?.z !== undefined ? fmt(opts.z) : '0.0';
      sink.push(
        '  0', 'INSERT',
        '  5', insertHandle,
        '330', currentOwner,
        '100', 'AcDbEntity',
        '  8', layer,
        '347', materialHandle(),
        '100', 'AcDbBlockReference',
        ...(hasAttribs ? [' 66', '     1'] : []),
        '  2', blockName,
        ' 10', fmt(x), ' 20', fmt(y), ' 30', z,
      );
      if (hasAttribs) {
        for (const a of attribs) {
          sink.push(
            '  0', 'ATTRIB',
            '  5', nextHandle(),
            '330', insertHandle,
            '100', 'AcDbEntity',
            '  8', layer,
            '100', 'AcDbText',
            ' 10', '0.0', ' 20', '0.0', ' 30', z,
            ' 40', '1.0',
            '  1', a.value,
            '100', 'AcDbAttribute',
            '  2', a.tag,
            ' 70', '     1',
            '280', '     0',
          );
        }
        sink.push(
          '  0', 'SEQEND',
          '  5', nextHandle(),
          '330', insertHandle,
          '100', 'AcDbEntity',
          '  8', '0',
          '347', materialHandle(),
        );
      }
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

    lwpolyline(layer, points, closed, xdata) {
      if (points.length < 2) return;
      sink.push('  0', 'LWPOLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbPolyline',
        ' 90', `     ${points.length}`, ' 70', `     ${closed ? 1 : 0}`);
      for (const p of points) {
        sink.push(' 10', fmt(p.x), ' 20', fmt(p.y));
        if (p.bulge !== undefined && p.bulge !== 0) sink.push(' 42', fmt(p.bulge));
      }
      emitXdata(sink, xdata);
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
      // BLOCK_RECORD TABLE — assembled here (not eagerly) so namedBlock() calls made after
      // createDxfDocument() returns can contribute their BLOCK_RECORD entries. Fixed count is
      // 2 (*Model_Space, *Paper_Space) + one per namedBlock() call; omitting namedBlock() (the
      // default) reproduces the exact prior count (2) and table byte-for-byte.
      const blockRecordTable = [
        '  0', 'TABLE', '  2', 'BLOCK_RECORD', '  5', blockRecordTableHandle, ' 70', `     ${2 + namedBlockCount}`,
        '  0', 'BLOCK_RECORD', '  5', modelSpaceHandle, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', '*Model_Space',
        '  0', 'BLOCK_RECORD', '  5', paperSpaceHandle, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', '*Paper_Space',
        ...namedBlockRecords,
        '  0', 'ENDTAB',
      ];
      const fullTables = [...tables, ...blockRecordTable, '  0', 'ENDSEC'];

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
      // Under sketchupCompat, the root dictionary declares 3 named entries pointing at minimal
      // empty DICTIONARY objects — presence is what viyar.pro's importer checks (see
      // CreateDxfDocumentOpts.sketchupCompat), not their contents.
      const objectsSection = opts.sketchupCompat
        ? (() => {
            const sectionViewStyleHandle = nextHandle();
            const recomposeDataHandle = nextHandle();
            const variableDictHandle = nextHandle();
            return [
              '  0', 'SECTION', '  2', 'OBJECTS',
              '  0', 'DICTIONARY', '  5', dictHandle, '330', '0', '100', 'AcDbDictionary', ' 70', '     0',
              '  3', 'ACAD_SECTIONVIEWSTYLE', '350', sectionViewStyleHandle,
              '  3', 'ACDB_RECOMPOSE_DATA', '350', recomposeDataHandle,
              '  3', 'AcDbVariableDictionary', '350', variableDictHandle,
              '  0', 'DICTIONARY', '  5', sectionViewStyleHandle, '330', dictHandle, '100', 'AcDbDictionary', ' 70', '     0',
              '  0', 'DICTIONARY', '  5', recomposeDataHandle, '330', dictHandle, '100', 'AcDbDictionary', ' 70', '     0',
              '  0', 'DICTIONARY', '  5', variableDictHandle, '330', dictHandle, '100', 'AcDbDictionary', ' 70', '     0',
              '  0', 'ENDSEC',
            ];
          })()
        : [
            '  0', 'SECTION', '  2', 'OBJECTS',
            '  0', 'DICTIONARY', '  5', dictHandle, '100', 'AcDbDictionary', ' 70', '     0',
            '  0', 'ENDSEC',
          ];

      // Assemble HEADER last so $HANDSEED reflects every handle allocated above.
      // Opt-in variables ($INSUNITS/$MEASUREMENT/$EXTMIN/$EXTMAX) are omitted entirely unless
      // the caller supplied them — omitting `opts` reproduces the prior HEADER byte-for-byte.
      const headerSection = [
        '  0', 'SECTION', '  2', 'HEADER',
        '  9', '$ACADVER', '  1', opts.acadVersion ?? 'AC1015',
        ...(opts.insunits !== undefined ? ['  9', '$INSUNITS', ' 70', `     ${opts.insunits}`] : []),
        ...(opts.measurement !== undefined ? ['  9', '$MEASUREMENT', ' 70', `     ${opts.measurement}`] : []),
        ...(opts.bbox !== undefined ? [
          '  9', '$EXTMIN', ' 10', fmt(opts.bbox.minX), ' 20', fmt(opts.bbox.minY), ' 30', '0.0',
          '  9', '$EXTMAX', ' 10', fmt(opts.bbox.maxX), ' 20', fmt(opts.bbox.maxY), ' 30', '0.0',
        ] : []),
        // $DIMALTF (alternate-units scale factor) — the header var live server debugging
        // isolated as the actual InvalidScaleError trigger (a raw export + this single
        // patched line got a full accept, 0 errors). Part of sketchupCompat, not its own opt.
        ...(opts.sketchupCompat ? ['  9', '$DIMALTF', ' 40', '25.4'] : []),
        '  9', '$HANDSEED', '  5', handleSeq.toString(16).toUpperCase(),
        '  0', 'ENDSEC',
      ];
      const classesSection = ['  0', 'SECTION', '  2', 'CLASSES', '  0', 'ENDSEC'];

      return [
        ...headerSection,
        ...classesSection,
        ...fullTables,
        ...blockSection,
        ...entSection,
        ...objectsSection,
        '  0', 'EOF',
      ].join('\n') + '\n';
    },
  };
}
