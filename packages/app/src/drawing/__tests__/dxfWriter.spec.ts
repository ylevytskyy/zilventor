// packages/app/src/drawing/__tests__/dxfWriter.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';

describe('dxfWriter — document scaffolding (DXF-SCAF)', () => {
  it('DXF-SCAF-1: produces matching SECTION/ENDSEC pairs (exactly 4: HEADER, TABLES, BLOCKS, ENTITIES)', () => {
    const doc = createDxfDocument();
    const out = doc.toString();
    // Count SECTION openings and ENDSEC closings
    const sections = (out.match(/\n\s*SECTION\s*\n/g) ?? []).length;
    const endsecs  = (out.match(/\n\s*ENDSEC\s*\n/g)  ?? []).length;
    expect(sections).toBe(endsecs);
    expect(sections).toBe(4); // HEADER, TABLES, BLOCKS, ENTITIES
  });

  it('DXF-SCAF-2: contains HEADER, TABLES, BLOCKS, ENTITIES section names', () => {
    const out = createDxfDocument().toString();
    expect(out).toContain('HEADER');
    expect(out).toContain('TABLES');
    expect(out).toContain('BLOCKS');
    expect(out).toContain('ENTITIES');
  });

  it('DXF-SCAF-6: BLOCKS section is ordered after TABLES and before ENTITIES', () => {
    const out = createDxfDocument().toString();
    const tablesPos   = out.indexOf('TABLES');
    const blocksPos   = out.indexOf('BLOCKS');
    const entitiesPos = out.indexOf('ENTITIES');
    expect(tablesPos,   'TABLES must appear in output').toBeGreaterThan(-1);
    expect(blocksPos,   'BLOCKS must appear in output').toBeGreaterThan(-1);
    expect(entitiesPos, 'ENTITIES must appear in output').toBeGreaterThan(-1);
    expect(blocksPos).toBeGreaterThan(tablesPos);
    expect(entitiesPos).toBeGreaterThan(blocksPos);
  });

  it('DXF-SCAF-3: terminates with group-code 0 / EOF', () => {
    const out = createDxfDocument().toString();
    const trimmed = out.trimEnd();
    // Last two non-empty lines must be '  0' and 'EOF'
    const lines = trimmed.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
    expect(lines[lines.length - 2]).toBe('  0');
    expect(lines[lines.length - 1]).toBe('EOF');
  });

  it('DXF-SCAF-4: LTYPE DASHED defined in TABLES', () => {
    const out = createDxfDocument().toString();
    expect(out).toContain('LTYPE');
    expect(out).toContain('DASHED');
  });

  it('DXF-SCAF-5: LAYER table contains all required layers', () => {
    const out = createDxfDocument().toString();
    const requiredLayers = ['VISIBLE', 'HIDDEN', 'SECTION-HATCH', 'SECTION-LINE',
      'DETAIL', 'DIMENSIONS', 'ANNOTATIONS', 'HOLE-TABLE', 'TITLE'];
    for (const layer of requiredLayers) {
      expect(out, `layer ${layer} must appear in TABLES`).toContain(layer);
    }
  });

  it('DXF-DIMSTYLE-1: DIMSTYLE table with STANDARD style defined in TABLES', () => {
    const out = createDxfDocument().toString();
    expect(out).toContain('DIMSTYLE');
    expect(out).toContain('STANDARD');
    // DIMSTYLE table must sit inside the TABLES section (before BLOCKS)
    expect(out.indexOf('DIMSTYLE')).toBeGreaterThan(out.indexOf('TABLES'));
    expect(out.indexOf('DIMSTYLE')).toBeLessThan(out.indexOf('BLOCKS'));
  });
});

describe('dxfWriter — anonymous blocks (DXF-BLOCK)', () => {
  it('DXF-BLOCK-1: block() emits BLOCK/ENDBLK in BLOCKS section and returns *D-name', () => {
    const doc = createDxfDocument();
    const name = doc.block(() => {
      doc.polyline('DIMENSIONS', [[0, 0], [10, 0]]);
      doc.text('DIMENSIONS', 5, 1, 3.5, '10');
    });
    const out = doc.toString();
    expect(name).toMatch(/^\*D\d+$/);
    expect(out).toContain('BLOCK');
    expect(out).toContain('ENDBLK');
    expect(out).toContain(name);
    // BLOCK definition lives in the BLOCKS section (before ENTITIES)
    expect(out.indexOf('BLOCK\n')).toBeGreaterThan(-1);
    const blocksPos = out.indexOf('BLOCKS');
    const entitiesPos = out.indexOf('ENTITIES');
    expect(out.indexOf('ENDBLK')).toBeGreaterThan(blocksPos);
    expect(out.indexOf('ENDBLK')).toBeLessThan(entitiesPos);
  });

  it('DXF-BLOCK-2: geometry inside block() is captured in the block, NOT the ENTITIES section', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 1, 2, 3, 4);            // goes to ENTITIES
    doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [9, 9]]); }); // goes to BLOCKS
    const out = doc.toString();
    const blocksPos = out.indexOf('BLOCKS');
    const entitiesPos = out.indexOf('ENTITIES');
    // The block's POLYLINE appears before ENTITIES (i.e. inside BLOCKS)
    const polyPos = out.indexOf('POLYLINE');
    expect(polyPos).toBeGreaterThan(blocksPos);
    expect(polyPos).toBeLessThan(entitiesPos);
    // The standalone LINE entity (group code 0 → LINE) appears in ENTITIES, not BLOCKS.
    // Use the LINE entity group-code pair position: look for '\n  0\nLINE\n' pattern.
    const lineEntityPos = out.indexOf('\n  0\nLINE\n');
    expect(lineEntityPos).toBeGreaterThan(entitiesPos);
  });

  it('DXF-BLOCK-3: two block() calls produce distinct *D names', () => {
    const doc = createDxfDocument();
    const n1 = doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [1, 0]]); });
    const n2 = doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [2, 0]]); });
    expect(n1).not.toBe(n2);
  });
});

describe('dxfWriter — entity emitters (DXF-ENT)', () => {
  it('DXF-ENT-1: line emits correct group codes', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 10, 20, 30, 40);
    const out = doc.toString();
    // Must contain LINE entity on VISIBLE layer with correct coords
    expect(out).toContain('LINE');
    expect(out).toContain('VISIBLE');
    // Group code 10 → x1=10, group code 20 → y1=20
    // Group code 11 → x2=30, group code 21 → y2=40
    const lines = out.split('\n');
    const lineIdx = lines.findIndex((l) => l.trim() === 'LINE');
    expect(lineIdx).toBeGreaterThan(-1);
    const entityBlock = lines.slice(lineIdx, lineIdx + 20).join('\n');
    expect(entityBlock).toContain('10.0000');
    expect(entityBlock).toContain('20.0000');
    expect(entityBlock).toContain('30.0000');
    expect(entityBlock).toContain('40.0000');
  });

  it('DXF-ENT-2: polyline emits POLYLINE/VERTEX/SEQEND sequence', () => {
    const doc = createDxfDocument();
    doc.polyline('HIDDEN', [[0, 0], [10, 5], [20, 0]]);
    const out = doc.toString();
    expect(out).toContain('POLYLINE');
    expect(out).toContain('VERTEX');
    expect(out).toContain('SEQEND');
    // Vertices-follow flag: group code 66 = 1
    expect(out).toContain(' 66');
    // Count VERTEX occurrences = 3
    const vertexCount = (out.match(/\bVERTEX\b/g) ?? []).length;
    expect(vertexCount).toBe(3);
  });

  it('DXF-ENT-3: polyline with < 2 points emits nothing', () => {
    const doc = createDxfDocument();
    doc.polyline('VISIBLE', [[5, 5]]);
    const out = doc.toString();
    expect(out).not.toContain('POLYLINE');
    expect(out).not.toContain('VERTEX');
  });

  it('DXF-ENT-4: circle emits CIRCLE with correct center and radius', () => {
    const doc = createDxfDocument();
    doc.circle('DETAIL', 15, 25, 7.5);
    const out = doc.toString();
    expect(out).toContain('CIRCLE');
    expect(out).toContain('DETAIL');
    // radius group code 40
    expect(out).toContain('7.5000');
  });

  it('DXF-ENT-5: text emits TEXT with correct coords, height, value', () => {
    const doc = createDxfDocument();
    doc.text('DIMENSIONS', 5, 10, 3.5, 'Hello DXF');
    const out = doc.toString();
    expect(out).toContain('TEXT');
    expect(out).toContain('DIMENSIONS');
    expect(out).toContain('Hello DXF');
    expect(out).toContain('3.5000'); // height
  });

  it('DXF-ENT-6: multiple entities in emission order', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 1, 1);
    doc.circle('DETAIL', 5, 5, 2);
    doc.text('TITLE', 0, 0, 4, 'Drawing A');
    const out = doc.toString();
    const linePos = out.indexOf('LINE');
    const circPos = out.indexOf('CIRCLE');
    const textPos = out.indexOf('TEXT');
    expect(linePos).toBeLessThan(circPos);
    expect(circPos).toBeLessThan(textPos);
  });

  it('DXF-ENT-7: fmt() guard — NaN, Infinity, -0 coords emit "0.0000" not invalid tokens', () => {
    // DXF parsers reject the literal tokens "NaN" and "Infinity".
    // fmt() must clamp non-finite and negative-zero to '0.0000'.
    const doc = createDxfDocument();
    doc.line('VISIBLE', NaN, Infinity, -0, -Infinity);
    const out = doc.toString();
    // Must NEVER contain invalid DXF tokens
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('Infinity');
    // All 4 coordinates must be emitted as '0.0000'
    // Extract the LINE entity block (from LINE up to next entity or ENDSEC)
    const lines = out.split('\n');
    const lineIdx = lines.findIndex((l) => l.trim() === 'LINE');
    expect(lineIdx).toBeGreaterThan(-1);
    const entityBlock = lines.slice(lineIdx, lineIdx + 20).join('\n');
    // x1=NaN → 0.0000, y1=Infinity → 0.0000, x2=-0 → 0.0000, y2=-Infinity → 0.0000
    const coordValues = entityBlock.match(/0\.0000/g) ?? [];
    expect(coordValues.length).toBeGreaterThanOrEqual(4);
  });
});
