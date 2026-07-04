import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDxf } from '../parser';
import { extractAbfPanels } from '../abfPanelExtraction';

/**
 * Regression lock against a REAL ABF flatten-DXF sample (trimmed to ~44KB from the
 * 902KB `~/Downloads/Стелаж flatten.dxf` evidence file — see
 * docs/superpowers/plans/2026-07-04-abf-import-as-panels.md §8/S6). Two panels kept
 * verbatim, byte-subset only (no hand-authored/synthesized entities): a door panel
 * (`__4. Дверка`, AUTO_THICKNESS_18) with 3 real hinge-cup bores + 6 leg-leveler
 * bores, and a side panel (`__11. Бік Пр`, SREE_PEARLS_2_THICKNESS_18) with 18
 * ABF-DSIDE/edge-oriented reference-only circles (no BoreOps).
 *
 * Expected values below were captured by running `extractAbfPanels` against the
 * FULL untrimmed 902KB sample first, then re-confirmed identical against this
 * trimmed fixture — the trim changes byte count only, never extraction output.
 */
const FIXTURE_PATH = join(__dirname, '../../../../../tests/e2e/fixtures/abf-flatten-sample.dxf');

describe('extractAbfPanels — real ABF sample fixture', () => {
  const text = readFileSync(FIXTURE_PATH, 'utf-8');
  const panels = extractAbfPanels(parseDxf(text));

  it('finds exactly the two trimmed panel roots, verbatim Cyrillic names', () => {
    expect(panels.map((p) => p.name)).toEqual(['__4. Дверка', '__11. Бік Пр']);
  });

  it('door panel: correct material group, bbox, and rectangular outline', () => {
    const door = panels.find((p) => p.name === '__4. Дверка')!;
    expect(door.materialGroup).toEqual({ token: 'AUTO_THICKNESS_18', material: 'AUTO', thicknessMm: 18 });
    expect(door.rectangular).toBe(true);
    expect(door.length).toBeCloseTo(319, 1);
    expect(door.width).toBeCloseTo(1395, 1);
  });

  it('door panel: reconstructs 3 real hinge-cup BoreOps (DEPTH13-ARTICLE96053, extrusion -Z)', () => {
    const door = panels.find((p) => p.name === '__4. Дверка')!;
    const hingeCups = door.circles.filter((c) => c.kind === 'bore' && c.role === 'hingeCup');
    expect(hingeCups).toHaveLength(3);
    for (const c of hingeCups) {
      expect(c).toMatchObject({
        kind: 'bore', diameter: 35, depth: 13, faceRole: 'Bottom',
        connectorKind: 'hinge', bestEffort: false, sku: '96053',
      });
    }
  });

  it('door panel: 6 best-effort leg-leveler face bores, no reference-only circles', () => {
    const door = panels.find((p) => p.name === '__4. Дверка')!;
    const legLevelers = door.circles.filter((c) => c.kind === 'bore' && c.role === 'legLeveler');
    expect(legLevelers).toHaveLength(6);
    expect(door.circles.filter((c) => c.kind === 'reference')).toHaveLength(0);
    expect(door.circles).toHaveLength(9);
  });

  it('side panel: correct material group and bbox', () => {
    const side = panels.find((p) => p.name === '__11. Бік Пр')!;
    expect(side.materialGroup).toEqual({
      token: 'SREE_PEARLS_2_THICKNESS_18', material: 'SREE_PEARLS_2', thicknessMm: 18,
    });
    expect(side.rectangular).toBe(true);
    expect(side.length).toBeCloseTo(592, 1);
    expect(side.width).toBeCloseTo(1364, 1);
  });

  it('side panel: all 18 edge-oriented ABF-DSIDE/DEPTH circles import as reference geometry only', () => {
    const side = panels.find((p) => p.name === '__11. Бік Пр')!;
    expect(side.circles).toHaveLength(18);
    expect(side.circles.every((c) => c.kind === 'reference')).toBe(true);
    expect(side.circles.filter((c) => c.kind === 'bore')).toHaveLength(0);
  });
});
