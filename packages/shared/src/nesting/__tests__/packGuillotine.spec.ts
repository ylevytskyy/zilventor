// packages/shared/src/nesting/__tests__/packGuillotine.spec.ts
import { describe, it, expect } from 'vitest';
import { packGuillotine } from '../packGuillotine';
import type { NestInputRow } from '../types';

const row = (overrides: Partial<NestInputRow> = {}): NestInputRow => ({
  itemNumber: 1, rowKey: 'r1', qty: 1, length: 600, width: 400,
  materialId: 'm1', grain: 'length', ...overrides,
});

describe('packGuillotine', () => {
  it('empty input → 0 sheets, 0 oversized', () => {
    const out = packGuillotine([], 2440, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(0);
    expect(out.oversized).toHaveLength(0);
  });

  it('single panel fits → 1 sheet, 1 panel at (0,0), rotated=false', () => {
    const out = packGuillotine([row()], 2440, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]!.panels).toHaveLength(1);
    expect(out.sheets[0]!.panels[0]).toMatchObject({ x: 0, y: 0, length: 600, width: 400, rotated: false });
  });

  it('single panel exceeds sheet (longer than sheet length) → 0 sheets, 1 oversized', () => {
    const out = packGuillotine([row({ length: 3000, width: 400, grain: 'length' })], 2440, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(0);
    expect(out.oversized).toEqual([{ itemNumber: 1, rowKey: 'r1' }]);
  });

  it('two same-size panels grain=none → 1 sheet, deterministic placement', () => {
    const r = row({ qty: 2, grain: 'none' });
    const a = packGuillotine([r], 2440, 1220, 3, 'm1');
    const b = packGuillotine([r], 2440, 1220, 3, 'm1');
    expect(a).toEqual(b);
    expect(a.sheets).toHaveLength(1);
    expect(a.sheets[0]!.panels).toHaveLength(2);
  });

  it("grain='length' forbids rotation even when rotation would pack better", () => {
    // Sheet 700×1220; panel 800×400 grain='length' would fit only rotated, but grain forbids it.
    const out = packGuillotine([row({ length: 800, width: 400, grain: 'length' })], 700, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(0);
    expect(out.oversized).toHaveLength(1);
  });

  it("grain='width' forces rotation (panel L=600,W=400 → placed with row's W along sheet length)", () => {
    // PlacedPanel.length is the sheet-length-axis dim. With grain='width', the row's W=400 goes along sheet length, so p.length=400 and p.width=600.
    const out = packGuillotine([row({ length: 600, width: 400, grain: 'width' })], 2440, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(1);
    const p = out.sheets[0]!.panels[0]!;
    expect(p.rotated).toBe(true);
    expect(p.length).toBe(400); // post-rotation: panel.width along sheet length
    expect(p.width).toBe(600);
  });

  it('kerf is applied between adjacent panels', () => {
    const r = row({ length: 300, width: 200, qty: 3, grain: 'length' });
    const out = packGuillotine([r], 2440, 1220, 5, 'm1');
    const xs = out.sheets[0]!.panels.map((p) => p.x).sort((a, b) => a - b);
    // First at x=0; second at x = 300 + 5 = 305; third at 305 + 300 + 5 = 610.
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(305);
    expect(xs[2]).toBe(610);
  });

  it('first-fit-decreasing ordering — golden test on 6-panel mix', () => {
    const rows: NestInputRow[] = [
      row({ rowKey: 'a', itemNumber: 1, length: 800, width: 400 }),
      row({ rowKey: 'b', itemNumber: 2, length: 600, width: 400 }),
      row({ rowKey: 'c', itemNumber: 3, length: 1000, width: 400 }),
      row({ rowKey: 'd', itemNumber: 4, length: 400, width: 400 }),
      row({ rowKey: 'e', itemNumber: 5, length: 1200, width: 400 }),
      row({ rowKey: 'f', itemNumber: 6, length: 200, width: 400 }),
    ];
    const out = packGuillotine(rows, 2440, 1220, 3, 'm1');
    // FFD by max(L,W) DESC: e(1200), c(1000), a(800), b(600), d(400), f(200)
    // All panels on the first sheet in placement order should follow FFD sort order.
    const allPanels = out.sheets[0]!.panels;
    expect(allPanels.map((p) => p.itemNumber)).toEqual([5, 3, 1, 2, 4, 6]);
  });

  it('determinism: same input twice → byte-identical sheet output', () => {
    const rows: NestInputRow[] = Array.from({ length: 8 }, (_, i) => row({
      itemNumber: i + 1, rowKey: `r${i}`, length: 300 + i * 50, width: 200, grain: 'none',
    }));
    const a = JSON.stringify(packGuillotine(rows, 2440, 1220, 3, 'm1'));
    const b = JSON.stringify(packGuillotine(rows, 2440, 1220, 3, 'm1'));
    expect(a).toBe(b);
  });

  it('multi-sheet — 3 large panels each >50% of a sheet → 3 sheets', () => {
    const r = row({ length: 1500, width: 800, qty: 3, grain: 'length' });
    const out = packGuillotine([r], 2440, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(3);
    out.sheets.forEach((s, i) => expect(s.sheetIndex).toBe(i + 1));
  });

  it('utilizationPct = panel area / sheet area × 100 (1 decimal)', () => {
    // Sheet 1000×1000; one panel 500×500 → 25.0%
    const out = packGuillotine([row({ length: 500, width: 500, grain: 'length' })], 1000, 1000, 0, 'm1');
    expect(out.sheets[0]!.utilizationPct).toBe(25.0);
  });

  it('expands qty correctly into multiple panels', () => {
    const out = packGuillotine([row({ qty: 4 })], 2440, 1220, 3, 'm1');
    expect(out.sheets[0]!.panels).toHaveLength(4);
    out.sheets[0]!.panels.forEach((p) => expect(p.itemNumber).toBe(1));
  });

  it('oversize expands the placed panel footprint (raw = net + oversize)', () => {
    const r = row({ length: 300, width: 200, grain: 'length', oversize: { lengthMm: 50, widthMm: 30 } });
    const out = packGuillotine([r], 2440, 1220, 3, 'm1');
    expect(out.sheets[0]!.panels[0]).toMatchObject({ x: 0, y: 0, length: 350, width: 230, rotated: false });
  });

  it('kerf is applied after the raw (oversized) footprint between two parts', () => {
    const r = row({ length: 300, width: 200, qty: 2, grain: 'length', oversize: { lengthMm: 50, widthMm: 0 } });
    const out = packGuillotine([r], 2440, 1220, 3, 'm1');
    const xs = out.sheets[0]!.panels.map((p) => p.x).sort((a, b) => a - b);
    // raw length 350; second part at 350 + 3 kerf = 353.
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(353);
  });

  it('a part that fits net but whose raw size exceeds the sheet is excluded as oversized', () => {
    // net 2400×400 fits sheet 2440×1220; oversize +100 length → raw 2500 > 2440.
    const r = row({ length: 2400, width: 400, grain: 'length', oversize: { lengthMm: 100, widthMm: 0 } });
    const out = packGuillotine([r], 2440, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(0);
    expect(out.oversized).toEqual([{ itemNumber: 1, rowKey: 'r1' }]);
  });

  it("grain='none' tie-break prefers rotated=false when scores are equal (square panel)", () => {
    // Square panel: rotation has no geometric effect (L=W), so both orientations
    // produce identical free-rect scores. Spec §3.1 requires rotated=false to win.
    const out = packGuillotine([row({ length: 500, width: 500, grain: 'none' })], 2440, 1220, 3, 'm1');
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]!.panels[0]!.rotated).toBe(false);
  });
});
