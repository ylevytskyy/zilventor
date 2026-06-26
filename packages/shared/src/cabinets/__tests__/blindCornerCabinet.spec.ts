import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildBlindCornerCabinet } from '../blindCornerCabinet';
import type { BlindCornerCabinetParams } from '../types';
import { hingeCountForHeight } from '../../hingeMath';

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

const P: BlindCornerCabinetParams = {
  name: 'Blind 1',
  width: 900, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 60,
  openingWidth: 450, blindSide: 'left',
  shelfCount: 0,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

const Tc = 18;

describe('buildBlindCornerCabinet — structure', () => {
  it('emits 8 panels for shelfCount=0 (6 carcass + 1 blindFiller + 1 door)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.panels).toHaveLength(8);
  });

  it('emits 9 panels for shelfCount=1', () => {
    const out = buildBlindCornerCabinet({ ...P, shelfCount: 1 }, REGISTRY);
    expect(out.panels).toHaveLength(9);
  });

  it('blindFiller role exists with correct dimensions', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const filler = out.panels.find(p => p.role === 'blindFiller')!;
    expect(filler).toBeDefined();
    // length = H - 2*Tc = 720 - 36 = 684
    expect((filler.panel.length as { value: number }).value).toBe(720 - 2 * Tc);
    // width = W - openingWidth - Tc = 900 - 450 - 18 = 432
    expect((filler.panel.width as { value: number }).value).toBe(900 - 450 - Tc);
  });

  it('no frontStile panel emitted (frameless — door hinges to side panel directly)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.panels.find(p => p.role === 'frontStile')).toBeUndefined();
  });

  it('door is sized to openingWidth not full cabinet width', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const door = out.panels.find(p => p.role === 'door')!;
    const doorW = (door.panel.width as { value: number }).value;
    expect(doorW).toBeLessThan(900 - 4); // narrower than full cabinet
    expect(doorW).toBeCloseTo(450 - 2 * 2, 1); // openingWidth - 2*reveal
  });

  it('door layout position X is offset to the live side (blindSide=left → xOffset=450)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    const doorW = 450 - 2 * 2; // 446
    // xOffset = W - openingWidth = 900 - 450 = 450; doorCenter = 450 + 446/2 = 673
    expect(doorComp.position.x).toBeCloseTo(450 + doorW / 2, 1);
  });
});

describe('buildBlindCornerCabinet — hinge boring', () => {
  it('doorBores has cupBores for the door panel', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.doorBores).toBeDefined();
    expect(out.doorBores!).toHaveLength(1);
    expect(out.doorBores![0]!.doorSuffix).toBe('Door');
    const doorH = 720 - 2 * 2; // 716
    const hingeCount = hingeCountForHeight(doorH);
    expect(out.doorBores![0]!.cupBores).toHaveLength(hingeCount);
  });

  it('plateBores has plate holes on the live-side carcass panel', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.plateBores).toBeDefined();
    expect(out.plateBores!).toHaveLength(1);
    // blindSide=left → live side is right → 'Right Side'
    expect(out.plateBores![0]!.panelSuffix).toBe('Right Side');
    const doorH = 720 - 2 * 2;
    const hingeCount = hingeCountForHeight(doorH);
    expect(out.plateBores![0]!.plateBores).toHaveLength(hingeCount * 2); // 2 plate holes per hinge
  });

  it('plate bore u positions form System-32 pairs (u±16) centered on each cup u; all at spec frontSetback v', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const cupBores = out.doorBores![0]!.cupBores;
    const plateBores = out.plateBores![0]!.plateBores;
    const hingeCount = cupBores.length;

    const cupUs = cupBores.map(b => b.u).sort((a, b) => a - b);
    const sortedPlateUs = plateBores.map(b => b.u).sort((a, b) => a - b);

    // 2 plate bores per hinge
    expect(sortedPlateUs).toHaveLength(hingeCount * 2);

    // Each consecutive pair: midpoint == cup u; spacing == 32 mm (PLATE_PAIR_SPACING)
    for (let i = 0; i < hingeCount; i++) {
      const lo = sortedPlateUs[i * 2]!;
      const hi = sortedPlateUs[i * 2 + 1]!;
      expect((lo + hi) / 2).toBeCloseTo(cupUs[i]!, 1);   // midpoint aligns with cup u
      expect(hi - lo).toBeCloseTo(32, 1);                 // 32 mm System-32 pitch
    }

    // All plate bores at the same v = depth - Td - PLATE_DEPTH = 560 - 18 - 13 = 529
    const expectedFrontSetback = 560 - 18 - 13;
    plateBores.forEach(b => expect(b.v).toBeCloseTo(expectedFrontSetback, 1));
  });
});

describe('buildBlindCornerCabinet — blindSide="right"', () => {
  const PR: BlindCornerCabinetParams = { ...P, blindSide: 'right' };

  it('door center X is offset to the left opening (openingXOffset = Tc)', () => {
    const out = buildBlindCornerCabinet(PR, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    const doorW = 450 - 2 * 2; // openingWidth - 2*reveal = 446
    // openingXOffset = Tc = 18; doorCenter = 18 + 446/2 = 241
    expect(doorComp.position.x).toBeCloseTo(Tc + doorW / 2, 1);
  });

  it('blindFiller is placed on the right side of the cabinet', () => {
    const out = buildBlindCornerCabinet(PR, REGISTRY);
    const fillerComp = out.layout.find(c => c.fileNameSuffix === 'Blind Filler')!;
    expect(fillerComp).toBeDefined();
    // filler x = W - Tc - blindFillerW = 900 - 18 - 432 = 450 (right half of cabinet)
    const blindFillerW = 900 - 450 - Tc; // 432
    expect(fillerComp.position.x).toBeCloseTo(900 - Tc - blindFillerW, 1);
    // must be to the right of the opening (≥ Tc + openingWidth would be ideal but filler starts at 450 = W/2)
    expect(fillerComp.position.x).toBeGreaterThanOrEqual(450);
  });

  it('plateBores targets Left Side panel (opening is on the left for right-blind)', () => {
    const out = buildBlindCornerCabinet(PR, REGISTRY);
    expect(out.plateBores![0]!.panelSuffix).toBe('Left Side');
  });
});

describe('buildBlindCornerCabinet — hardware', () => {
  it('emits hinge SKU with correct count', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const doorH = 720 - 2 * 2;
    expect(out.hardware).toEqual([
      { skuId: 'hinge-35mm-cup-full', count: hingeCountForHeight(doorH) },
    ]);
  });
});

describe('buildBlindCornerCabinet — validation', () => {
  it('rejects openingWidth >= width', () => {
    expect(() => buildBlindCornerCabinet({ ...P, openingWidth: 900 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'blindOpeningTooLarge' }));
  });

  it('rejects openingWidth < 2*Tc', () => {
    expect(() => buildBlindCornerCabinet({ ...P, openingWidth: 30 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'blindOpeningTooSmall' }));
  });

  it('rejects missing carcass material', () => {
    expect(() => buildBlindCornerCabinet({ ...P, carcassMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'carcassMaterialMissing' }));
  });
});
