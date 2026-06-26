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
  it('emits 9 panels for shelfCount=0 (6 carcass + 1 filler + 1 toekick + 1 door)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.panels).toHaveLength(9);
  });

  it('emits 10 panels for shelfCount=1', () => {
    const out = buildBlindCornerCabinet({ ...P, shelfCount: 1 }, REGISTRY);
    expect(out.panels).toHaveLength(10);
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

  it('cup bore U positions match plate bore U positions (alignment)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const cupUs = out.doorBores![0]!.cupBores.map(b => b.u).sort((a, b) => a - b);
    const plateUs = [...new Set(out.plateBores![0]!.plateBores.map(b => b.u))].sort((a, b) => a - b);
    expect(cupUs.length).toBe(plateUs.length);
    cupUs.forEach((u, i) => expect(u).toBeCloseTo(plateUs[i]!, 1));
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
