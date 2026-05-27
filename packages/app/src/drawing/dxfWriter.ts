// packages/app/src/drawing/dxfWriter.ts
/**
 * Minimal AutoCAD R12 (AC1009) ASCII DXF builder.
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
  const header: string[] = [];
  const tables: string[] = [];

  // ── HEADER section (minimal: only version variable) ──────────────────────
  header.push('  0', 'SECTION', '  2', 'HEADER');
  header.push('  9', '$ACADVER', '  1', 'AC1009');
  header.push('  0', 'ENDSEC');

  // ── TABLES section ────────────────────────────────────────────────────────
  tables.push('  0', 'SECTION', '  2', 'TABLES');

  // LTYPE table — define CONTINUOUS and DASHED
  tables.push('  0', 'TABLE', '  2', 'LTYPE', ' 70', '     2');
  tables.push(
    '  0', 'LTYPE', '  2', 'CONTINUOUS',
    ' 70', '     0', '  3', 'Solid line',
    ' 72', '    65', ' 73', '     0', ' 40', '0.0',
  );
  tables.push(
    '  0', 'LTYPE', '  2', 'DASHED',
    ' 70', '     0', '  3', 'Dashed line',
    ' 72', '    65', ' 73', '     2',
    ' 40', '6.0', ' 49', '4.0', ' 49', '-2.0',
  );
  tables.push('  0', 'ENDTAB');

  // LAYER table
  tables.push('  0', 'TABLE', '  2', 'LAYER', ' 70', `     ${LAYERS.length}`);
  for (const name of LAYERS) {
    const ltype = name === 'HIDDEN' ? 'DASHED' : 'CONTINUOUS';
    const color = name === 'HIDDEN' ? '     3' : '     7'; // 3=green hidden, 7=white/black visible
    tables.push(
      '  0', 'LAYER',
      '  2', name,
      ' 70', '     0',   // not frozen/off
      ' 62', color,
      '  6', ltype,
    );
  }
  tables.push('  0', 'ENDTAB');

  // DIMSTYLE table — one shared STANDARD style (drives native DIMENSION regen)
  tables.push('  0', 'TABLE', '  2', 'DIMSTYLE', ' 70', '     1');
  tables.push(
    '  0', 'DIMSTYLE',
    '  2', 'STANDARD',
    ' 70', '     0',
    '140', '3.5',     // DIMTXT  — text height (matches dim-label text height)
    ' 41', '2.5',     // DIMASZ  — arrow size
    '147', '0.625',   // DIMGAP
    ' 77', '     1',  // DIMTAD  — text above the dimension line
    ' 73', '     0',  // DIMTIH  — inside text aligned with dim line
    ' 74', '     0',  // DIMTOH  — outside text aligned with dim line
  );
  tables.push('  0', 'ENDTAB');

  tables.push('  0', 'ENDSEC');

  // ── BLOCKS section accumulator (block definitions appended by block()) ──
  const blockDefs: string[] = [];

  // Internal entities accumulator — populated by emitters
  const ents: string[] = [];
  // Current emission target: ENTITIES by default, redirected into a block during block().
  let sink: string[] = ents;
  let anonCounter = 0;

  return {
    line(layer, x1, y1, x2, y2, aci) {
      sink.push(
        '  0', 'LINE',
        '  8', layer,
        ...(aci !== undefined ? [' 62', String(aci)] : []),
        ' 10', fmt(x1), ' 20', fmt(y1),
        ' 11', fmt(x2), ' 21', fmt(y2),
      );
    },

    polyline(layer, points) {
      if (points.length < 2) return;
      sink.push(
        '  0', 'POLYLINE',
        '  8', layer,
        ' 66', '     1',  // vertices follow flag
        ' 10', '0.0', ' 20', '0.0',  // dummy coords (R12 POLYLINE origin)
        ' 70', '     0',  // open polyline
      );
      for (const [x, y] of points) {
        sink.push(
          '  0', 'VERTEX',
          '  8', layer,
          ' 10', fmt(x), ' 20', fmt(y),
        );
      }
      sink.push('  0', 'SEQEND', '  8', layer);
    },

    circle(layer, cx, cy, r) {
      sink.push(
        '  0', 'CIRCLE',
        '  8', layer,
        ' 10', fmt(cx), ' 20', fmt(cy),
        ' 40', fmt(r),
      );
    },

    text(layer, x, y, height, value, rotation = 0) {
      sink.push(
        '  0', 'TEXT',
        '  8', layer,
        ' 10', fmt(x), ' 20', fmt(y),
        ' 40', fmt(height),
        '  1', value,
        ' 50', fmt(rotation),
      );
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
        '  8', opts.layer,
        '  2', opts.blockName,
        ' 10', fmt(opts.defPoint[0]), ' 20', fmt(opts.defPoint[1]), ' 30', '0.0',
        ' 11', fmt(opts.textMid[0]), ' 21', fmt(opts.textMid[1]), ' 31', '0.0',
        ' 70', `     ${opts.dimType}`,
        '  1', opts.text,
        '  3', opts.dimStyle,
      );
      if (opts.rotation !== undefined) ents.push(' 50', fmt(opts.rotation));
      for (const [code, x, y] of opts.extraPoints ?? []) {
        ents.push(
          pad(code), fmt(x),
          pad(code + 10), fmt(y),
          pad(code + 20), '0.0',
        );
      }
    },

    toString() {
      const blockSection = [
        '  0', 'SECTION', '  2', 'BLOCKS',
        ...blockDefs,
        '  0', 'ENDSEC',
      ];
      const entSection = [
        '  0', 'SECTION', '  2', 'ENTITIES',
        ...ents,
        '  0', 'ENDSEC',
      ];
      return [
        ...header,
        ...tables,
        ...blockSection,
        ...entSection,
        '  0', 'EOF',
      ].join('\n') + '\n';
    },
  };
}
