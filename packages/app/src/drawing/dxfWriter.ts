// packages/app/src/drawing/dxfWriter.ts
/**
 * Minimal AutoCAD R12 (AC1009) ASCII DXF builder.
 * All entity emitters accept already-transformed, already-Y-flipped coordinates.
 * Caller (renderDrawingDxf) owns the coordinate transform.
 */

export type DxfDocument = {
  /** Emit a LINE entity. */
  line(layer: string, x1: number, y1: number, x2: number, y2: number): void;
  /** Emit a POLYLINE/VERTEX[]/SEQEND entity sequence (R12 — not LWPOLYLINE). */
  polyline(layer: string, points: ReadonlyArray<readonly [number, number]>): void;
  /** Emit a CIRCLE entity. */
  circle(layer: string, cx: number, cy: number, r: number): void;
  /** Emit a TEXT entity. rotation defaults to 0. */
  text(layer: string, x: number, y: number, height: number, value: string, rotation?: number): void;
  /** Serialize to DXF string. */
  toString(): string;
};

const LAYERS = [
  'VISIBLE', 'HIDDEN', 'SECTION-HATCH', 'SECTION-LINE',
  'DETAIL', 'DIMENSIONS', 'ANNOTATIONS', 'HOLE-TABLE', 'TITLE',
] as const;

function fmt(n: number): string {
  // DXF R12 coords: up to 6 decimal places, no trailing zeros beyond 3
  return n.toFixed(4);
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

  tables.push('  0', 'ENDSEC');

  // Internal entities accumulator — populated by emitters
  const ents: string[] = [];

  return {
    line(layer, x1, y1, x2, y2) {
      ents.push(
        '  0', 'LINE',
        '  8', layer,
        ' 10', fmt(x1), ' 20', fmt(y1),
        ' 11', fmt(x2), ' 21', fmt(y2),
      );
    },

    polyline(layer, points) {
      if (points.length < 2) return;
      ents.push(
        '  0', 'POLYLINE',
        '  8', layer,
        ' 66', '     1',  // vertices follow flag
        ' 10', '0.0', ' 20', '0.0',  // dummy coords (R12 POLYLINE origin)
        ' 70', '     0',  // open polyline
      );
      for (const [x, y] of points) {
        ents.push(
          '  0', 'VERTEX',
          '  8', layer,
          ' 10', fmt(x), ' 20', fmt(y),
        );
      }
      ents.push('  0', 'SEQEND', '  8', layer);
    },

    circle(layer, cx, cy, r) {
      ents.push(
        '  0', 'CIRCLE',
        '  8', layer,
        ' 10', fmt(cx), ' 20', fmt(cy),
        ' 40', fmt(r),
      );
    },

    text(layer, x, y, height, value, rotation = 0) {
      ents.push(
        '  0', 'TEXT',
        '  8', layer,
        ' 10', fmt(x), ' 20', fmt(y),
        ' 40', fmt(height),
        '  1', value,
        ' 50', fmt(rotation),
      );
    },

    toString() {
      const entSection = [
        '  0', 'SECTION', '  2', 'ENTITIES',
        ...ents,
        '  0', 'ENDSEC',
      ];
      return [
        ...header,
        ...tables,
        ...entSection,
        '  0', 'EOF',
      ].join('\n') + '\n';
    },
  };
}
