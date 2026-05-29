// packages/app/src/drawing/__tests__/parseDxfUnderlay.spec.ts
// F1 (DXF parser) TDD spec. Written RED before parseDxfUnderlay.ts exists.

import { parseDxfUnderlay } from '../parseDxfUnderlay';
import type { DxfUnderlay } from '@zilventor/shared/drawing/types';

// ---------------------------------------------------------------------------
// Helpers — hand-written minimal ASCII DXF strings (group-code / value pairs).
// Each fixture is the smallest valid DXF that exercises one entity type.
// ---------------------------------------------------------------------------

function makeDxf(entitiesSection: string): string {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    entitiesSection.trim(),
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

function makeBlocksDxf(blockName: string, blockEntities: string, insertX: number, insertY: number): string {
  return [
    '0', 'SECTION',
    '2', 'BLOCKS',
    '0', 'BLOCK',
    '2', blockName,
    '70', '0',
    '10', '0.0',
    '20', '0.0',
    '30', '0.0',
    blockEntities.trim(),
    '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'INSERT',
    '2', blockName,
    '10', String(insertX),
    '20', String(insertY),
    '30', '0.0',
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINE_DXF = makeDxf([
  '0', 'LINE',
  '8', '0',
  '10', '5.0',    // start x
  '20', '10.0',   // start y
  '30', '0.0',
  '11', '15.0',   // end x
  '21', '25.0',   // end y
  '31', '0.0',
].join('\n'));

const LWPOLYLINE_DXF = makeDxf([
  '0', 'LWPOLYLINE',
  '8', '0',
  '90', '3',     // vertex count
  '70', '0',     // flags: open (bit 0 = 0)
  '10', '0.0',
  '20', '0.0',
  '10', '10.0',
  '20', '0.0',
  '10', '10.0',
  '20', '10.0',
].join('\n'));

const CIRCLE_DXF = makeDxf([
  '0', 'CIRCLE',
  '8', '0',
  '10', '50.0',   // cx
  '20', '60.0',   // cy
  '30', '0.0',
  '40', '7.5',    // radius
].join('\n'));

const ARC_DXF = makeDxf([
  '0', 'ARC',
  '8', '0',
  '10', '30.0',   // cx
  '20', '40.0',   // cy
  '30', '0.0',
  '40', '15.0',   // radius
  '50', '45.0',   // startAngle
  '51', '135.0',  // endAngle
].join('\n'));

const TEXT_DXF = makeDxf([
  '0', 'TEXT',
  '8', '0',
  '10', '20.0',   // x
  '20', '30.0',   // y
  '30', '0.0',
  '40', '5.0',    // text height
  '1', 'Hello',   // text value
  '50', '15.0',   // rotation
].join('\n'));

const MULTI_ENTITY_DXF = makeDxf([
  '0', 'LINE',
  '8', '0',
  '10', '0.0',
  '20', '0.0',
  '30', '0.0',
  '11', '10.0',
  '21', '0.0',
  '31', '0.0',
  '0', 'CIRCLE',
  '8', '0',
  '10', '5.0',
  '20', '5.0',
  '30', '0.0',
  '40', '3.0',
  '0', 'ARC',
  '8', '0',
  '10', '0.0',
  '20', '0.0',
  '30', '0.0',
  '40', '10.0',
  '50', '0.0',
  '51', '90.0',
  '0', 'TEXT',
  '8', '0',
  '10', '2.0',
  '20', '2.0',
  '30', '0.0',
  '40', '3.0',
  '1', 'Label',
  '50', '0.0',
].join('\n'));

// Block INSERT fixture: block "MYBLOCK" contains a LINE from (1,2) to (11,2).
// INSERT at (100, 200) → flattened line should be at (101,202) to (111,202).
const INSERT_DXF = makeBlocksDxf(
  'MYBLOCK',
  [
    '0', 'LINE',
    '8', '0',
    '10', '1.0',
    '20', '2.0',
    '30', '0.0',
    '11', '11.0',
    '21', '2.0',
    '31', '0.0',
  ].join('\n'),
  100,
  200,
);

const MALFORMED_DXF = 'this is not a dxf file at all @@@ ???';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseDxfUnderlay', () => {
  describe('LINE entity', () => {
    it('maps a LINE to a line UnderlayEntity with correct coordinates', () => {
      const result: DxfUnderlay = parseDxfUnderlay(LINE_DXF, 'test.dxf');
      expect(result.entities).toHaveLength(1);
      const e = result.entities[0];
      expect(e.kind).toBe('line');
      if (e.kind === 'line') {
        expect(e.x1).toBeCloseTo(5);
        expect(e.y1).toBeCloseTo(10);
        expect(e.x2).toBeCloseTo(15);
        expect(e.y2).toBeCloseTo(25);
      }
    });
  });

  describe('LWPOLYLINE entity', () => {
    it('maps an open LWPOLYLINE to a polyline with correct points and closed=false', () => {
      const result = parseDxfUnderlay(LWPOLYLINE_DXF, 'poly.dxf');
      expect(result.entities).toHaveLength(1);
      const e = result.entities[0];
      expect(e.kind).toBe('polyline');
      if (e.kind === 'polyline') {
        expect(e.closed).toBe(false);
        expect(e.points).toHaveLength(3);
        expect(e.points[0]).toEqual([0, 0]);
        expect(e.points[1]).toEqual([10, 0]);
        expect(e.points[2]).toEqual([10, 10]);
      }
    });
  });

  describe('CIRCLE entity', () => {
    it('maps a CIRCLE to a circle UnderlayEntity with center and radius', () => {
      const result = parseDxfUnderlay(CIRCLE_DXF, 'circle.dxf');
      expect(result.entities).toHaveLength(1);
      const e = result.entities[0];
      expect(e.kind).toBe('circle');
      if (e.kind === 'circle') {
        expect(e.cx).toBeCloseTo(50);
        expect(e.cy).toBeCloseTo(60);
        expect(e.r).toBeCloseTo(7.5);
      }
    });
  });

  describe('ARC entity', () => {
    it('maps an ARC to an arc UnderlayEntity with center, radius, and angles in degrees', () => {
      const result = parseDxfUnderlay(ARC_DXF, 'arc.dxf');
      expect(result.entities).toHaveLength(1);
      const e = result.entities[0];
      expect(e.kind).toBe('arc');
      if (e.kind === 'arc') {
        expect(e.cx).toBeCloseTo(30);
        expect(e.cy).toBeCloseTo(40);
        expect(e.r).toBeCloseTo(15);
        expect(e.startAngle).toBeCloseTo(45);
        expect(e.endAngle).toBeCloseTo(135);
      }
    });
  });

  describe('TEXT entity', () => {
    it('maps a TEXT to a text UnderlayEntity with insertion, height, value, and rotation', () => {
      const result = parseDxfUnderlay(TEXT_DXF, 'text.dxf');
      expect(result.entities).toHaveLength(1);
      const e = result.entities[0];
      expect(e.kind).toBe('text');
      if (e.kind === 'text') {
        expect(e.x).toBeCloseTo(20);
        expect(e.y).toBeCloseTo(30);
        expect(e.height).toBeCloseTo(5);
        expect(e.value).toBe('Hello');
        expect(e.rotation).toBeCloseTo(15);
      }
    });
  });

  describe('multiple entities', () => {
    it('parses multiple entity types and emits correct counts', () => {
      const result = parseDxfUnderlay(MULTI_ENTITY_DXF, 'multi.dxf');
      expect(result.entities).toHaveLength(4);
      const kinds = result.entities.map(e => e.kind);
      expect(kinds).toContain('line');
      expect(kinds).toContain('circle');
      expect(kinds).toContain('arc');
      expect(kinds).toContain('text');
    });
  });

  describe('INSERT / block flattening', () => {
    it('flattens block entities referenced by INSERT, applying insert translation', () => {
      const result = parseDxfUnderlay(INSERT_DXF, 'insert.dxf');
      // The INSERT should be replaced by the LINE from the block, translated by (100, 200)
      // Block LINE: (1,2)→(11,2). Insert offset: (100,200). Expected: (101,202)→(111,202).
      const lines = result.entities.filter(e => e.kind === 'line');
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const line = lines[0];
      if (line.kind === 'line') {
        expect(line.x1).toBeCloseTo(101);
        expect(line.y1).toBeCloseTo(202);
        expect(line.x2).toBeCloseTo(111);
        expect(line.y2).toBeCloseTo(202);
      }
    });
  });

  describe('sourceBBoxMm', () => {
    it('computes the bounding box over all emitted entities', () => {
      const result = parseDxfUnderlay(LINE_DXF, 'bbox.dxf');
      expect(result.sourceBBoxMm).toBeDefined();
      const bb = result.sourceBBoxMm!;
      expect(bb.minX).toBeCloseTo(5);
      expect(bb.minY).toBeCloseTo(10);
      expect(bb.maxX).toBeCloseTo(15);
      expect(bb.maxY).toBeCloseTo(25);
    });

    it('returns undefined sourceBBoxMm when entities list is empty', () => {
      const result = parseDxfUnderlay(MALFORMED_DXF, 'empty.dxf');
      expect(result.sourceBBoxMm).toBeUndefined();
    });
  });

  describe('name', () => {
    it('strips extension from fileName to produce name', () => {
      const result = parseDxfUnderlay(MALFORMED_DXF, 'my-drawing.dxf');
      expect(result.name).toBe('my-drawing');
    });

    it('handles fileName without extension', () => {
      const result = parseDxfUnderlay(MALFORMED_DXF, 'nodot');
      expect(result.name).toBe('nodot');
    });
  });

  describe('robustness', () => {
    it('returns empty entities for malformed DXF — never throws', () => {
      expect(() => parseDxfUnderlay(MALFORMED_DXF, 'bad.dxf')).not.toThrow();
      const result = parseDxfUnderlay(MALFORMED_DXF, 'bad.dxf');
      expect(result.entities).toHaveLength(0);
    });

    it('returns empty entities for empty string', () => {
      expect(() => parseDxfUnderlay('', 'empty.dxf')).not.toThrow();
      const result = parseDxfUnderlay('', 'empty.dxf');
      expect(result.entities).toHaveLength(0);
    });
  });
});
