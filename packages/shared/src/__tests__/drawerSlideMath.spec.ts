import { describe, it, expect } from 'vitest';
import { drawerSlideMath } from '../drawerSlideMath';
import {
  BOX_VERT_CLEARANCE,
  SLIDE_GRID_PITCH,
  DRAWER_SLIDE_FRONT_SETBACK,
  DRAWER_SLIDE_HOLE_DIAMETER,
} from '../drawerConventions';

const ctx = {
  drawerIndex: 1,
  openBottomZ: 100,
  slotH: 200,
  bh: 176,
  cabinet: { H: 720, D: 500, Tc: 18 },
  box: { bd: 490 },
  slideLength: 450,
};

describe('drawerSlideMath', () => {
  const r = drawerSlideMath(ctx);

  // Independent target: rail world-Z for drawer i=1
  // slideWorldZ = openBottomZ + i*slotH + BOX_VERT_CLEARANCE + bh/2
  //             = 100 + 1*200 + 12 + 88 = 400   (C-7: was 410, fixed to 400)
  const slideWorldZ = 100 + 1 * 200 + BOX_VERT_CLEARANCE + 176 / 2; // 400

  it('cabinet rows on left & right inner faces at the rail height', () => {
    // LEFT_SIDE_INNER_FACE = 'Top', RIGHT_SIDE_INNER_FACE = 'Bottom'
    const left = r.cabinetBores.filter((b) => b.face.role === 'Top');
    const right = r.cabinetBores.filter((b) => b.face.role === 'Bottom');
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(right.length).toBe(left.length);

    // Cabinet side panel: length=H=720, spans world-Z 0..720.
    // Top face: u runs along part-X (length=height), panel bottom at world-Z=0.
    // World-Z of a bore = panelBottomZ + u = 0 + u → u_cabinet_expected = slideWorldZ = 400.
    const expectedU_cabinet = slideWorldZ; // 400 — independent of box
    left.forEach((b) => expect(b.u).toBeCloseTo(expectedU_cabinet, 6));
    right.forEach((b) => expect(b.u).toBeCloseTo(expectedU_cabinet, 6));
  });

  it('box-side rows align to the SAME independent rail height (different local-u)', () => {
    expect(r.boxBores.length).toBe(r.cabinetBores.length);

    // Box side panel: length=bh=176. Box bottom sits at world-Z:
    //   boxOriginZ = openBottomZ + i*slotH + BOX_VERT_CLEARANCE = 100+200+12 = 312
    // World-Z of a bore = boxOriginZ + u → u_box_expected = slideWorldZ - boxOriginZ = 400 - 312 = 88.
    // Also equals bh/2 = 88 (the box mid-height), which is a known geometric identity.
    // This is DIFFERENT from u_cabinet=400, so cabinet-vs-box comparison cannot pass a symmetric bug.
    const boxOriginZ = 100 + 1 * 200 + BOX_VERT_CLEARANCE; // 312
    const expectedU_box = slideWorldZ - boxOriginZ; // 88 = bh/2
    r.boxBores.forEach((b) => expect(b.u).toBeCloseTo(expectedU_box, 6));
  });

  it('Ø5 holes on 32mm grid, ≥2 per side, setback from front', () => {
    expect(r.cabinetBores.every((b) => b.diameter === DRAWER_SLIDE_HOLE_DIAMETER)).toBe(true);
    const vs = r.cabinetBores
      .filter((b) => b.face.role === 'Top')
      .map((b) => b.v)
      .sort((a, c) => a - c);
    expect(vs[0]!).toBeCloseTo(DRAWER_SLIDE_FRONT_SETBACK, 6);
    expect(vs[1]! - vs[0]!).toBeCloseTo(SLIDE_GRID_PITCH, 6);
  });

  it('one connectorId per (drawer, side); cabinet+box bores share it', () => {
    const ids = new Set(r.cabinetBores.concat(r.boxBores).map((b) => b.connectorId));
    expect(ids.size).toBe(2); // left + right
  });

  it('all bores have correct roles and connectorKind', () => {
    r.cabinetBores.forEach((b) => {
      expect(b.role).toBe('drawerSlide-cabinet');
      expect(b.connectorKind).toBe('drawerSlide');
    });
    r.boxBores.forEach((b) => {
      expect(b.role).toBe('drawerSlide-box');
      expect(b.connectorKind).toBe('drawerSlide');
    });
  });

  it('cabinet and box bores for the same side share connectorId', () => {
    const leftCabIds = r.cabinetBores
      .filter((b) => b.face.role === 'Top')
      .map((b) => b.connectorId);
    const leftBoxIds = r.boxBores
      .filter((b) => b.face.role === 'Top')
      .map((b) => b.connectorId);
    expect(new Set(leftCabIds).size).toBe(1);
    expect(new Set(leftBoxIds).size).toBe(1);
    expect([...new Set(leftCabIds)][0]).toBe([...new Set(leftBoxIds)][0]);
  });
});
