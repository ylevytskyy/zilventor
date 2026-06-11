import { describe, it, expect } from 'vitest';
import {
  hingeCountForHeight,
  hingePositions,
  hingeCupBores,
  hingePlateBores,
  HINGE_END_INSET,
  CUP_SETBACK,
  CUP_DIAMETER,
  CUP_DEPTH,
  PLATE_DIAMETER,
  PLATE_DEPTH,
  PLATE_PAIR_SPACING,
} from '../hingeMath';
import { face2DFrame } from '../bore';
import { DOOR_CUP_FACE, LEFT_SIDE_INNER_FACE } from '../prisadkaFaceConventions';
import type { BoreOp } from '../bore';

// Door part dims: length=doorH, width=doorW, thickness=Td (buildPanelBox convention).
const DOOR_DIMS = { length: 716, width: 596, thickness: 18 };

/** World point of a bore (u,v) on a given face of the door box (no component pose). */
function worldOf(dims: { length: number; width: number; thickness: number }, b: BoreOp) {
  const f = face2DFrame(dims, b.face.role as 'Top' | 'Bottom');
  return {
    x: f.origin.x + b.u * f.uDir.x + b.v * f.vDir.x,
    y: f.origin.y + b.u * f.uDir.y + b.v * f.vDir.y,
    z: f.origin.z + b.u * f.uDir.z + b.v * f.vDir.z,
  };
}

describe('hingeCountForHeight — threshold rule (spec §7b)', () => {
  it('≤900 → 2 hinges', () => {
    expect(hingeCountForHeight(600)).toBe(2);
    expect(hingeCountForHeight(900)).toBe(2);
  });
  it('901..1500 → 3 hinges', () => {
    expect(hingeCountForHeight(901)).toBe(3);
    expect(hingeCountForHeight(1500)).toBe(3);
  });
  it('1501..2000 → 4 hinges', () => {
    expect(hingeCountForHeight(1501)).toBe(4);
    expect(hingeCountForHeight(2000)).toBe(4);
  });
  it('2001..2400 → 5 hinges', () => {
    expect(hingeCountForHeight(2001)).toBe(5);
    expect(hingeCountForHeight(2400)).toBe(5);
  });
  it('>2400 → 5 hinges (contract default)', () => {
    expect(hingeCountForHeight(2700)).toBe(5);
  });
});

describe('hingePositions — Z centers along doorH', () => {
  it('count=2: one near each end at ~HINGE_END_INSET from the door ends', () => {
    const p = hingePositions(720, 2);
    expect(p).toHaveLength(2);
    expect(p[0]!).toBeCloseTo(HINGE_END_INSET, 6);
    expect(p[1]!).toBeCloseTo(720 - HINGE_END_INSET, 6);
  });
  it('positions are ascending and strictly inside (0, doorH)', () => {
    const p = hingePositions(2000, 4);
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThan(p[i - 1]!);
    expect(p[0]!).toBeGreaterThan(0);
    expect(p[p.length - 1]!).toBeLessThan(2000);
  });
  it('count=3: ends at inset, middle evenly between them', () => {
    const p = hingePositions(1200, 3);
    expect(p).toHaveLength(3);
    expect(p[0]!).toBeCloseTo(HINGE_END_INSET, 6);
    expect(p[2]!).toBeCloseTo(1200 - HINGE_END_INSET, 6);
    expect(p[1]!).toBeCloseTo((p[0]! + p[2]!) / 2, 6);
  });
  it('count=1 degenerate: single hinge at door mid-height', () => {
    const p = hingePositions(800, 1);
    expect(p).toEqual([400]);
  });
});

describe('hingeCupBores — Ø35 cups on the door broad face', () => {
  const u = hingePositions(DOOR_DIMS.length, hingeCountForHeight(DOOR_DIMS.length));

  it('emits one cup per hinge with role/kind/diameter/blind depth', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    expect(bores).toHaveLength(u.length);
    for (const b of bores) {
      expect(b.role).toBe('hingeCup');
      expect(b.connectorKind).toBe('hinge');
      expect(b.diameter).toBe(CUP_DIAMETER);
      expect(b.depth).toBe(CUP_DEPTH);
      expect(b.depth).not.toBe('throughAll'); // blind, < Td
      // face.role must be the imported DOOR_CUP_FACE constant — NOT a local re-declaration
      expect(b.face.role).toBe(DOOR_CUP_FACE);
    }
  });

  it('cup u positions equal the shared hingePositions (along doorH)', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    expect(bores.map((b) => b.u)).toEqual(u);
  });

  // World-Y math for DOOR_CUP_FACE='Bottom':
  //   Bottom frame: origin.y = +doorW/2 = +298, vDir.y = -1
  //   w.y = +298 - v
  //   hingeSide='left': v=CUP_SETBACK.full=21 → w.y = +298-21 = +277 = +doorW/2 - CUP_SETBACK.full
  it('hingeSide=left: cups within CUP_SETBACK of the v=0 door edge (world-Y verified for DOOR_CUP_FACE)', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    for (const b of bores) {
      expect(b.v).toBeCloseTo(CUP_SETBACK.full, 6); // setback from the v=0 edge
      // Bottom face: origin.y = +W/2; w.y = +W/2 - v
      const w = worldOf(DOOR_DIMS, b);
      expect(w.y).toBeCloseTo(DOOR_DIMS.width / 2 - CUP_SETBACK.full, 6);
    }
  });

  // hingeSide='right': v=doorW-CUP_SETBACK.full=575 → w.y = +298-575 = -277 = -doorW/2+CUP_SETBACK.full
  it('hingeSide=right: cups within CUP_SETBACK of the v=doorW door edge (world-Y verified for DOOR_CUP_FACE)', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'right', 'full', u);
    for (const b of bores) {
      expect(b.v).toBeCloseTo(DOOR_DIMS.width - CUP_SETBACK.full, 6);
      // Bottom face: w.y = +W/2 - v = +298 - (W - setback) = setback - W/2
      const w = worldOf(DOOR_DIMS, b);
      expect(w.y).toBeCloseTo(-DOOR_DIMS.width / 2 + CUP_SETBACK.full, 6);
    }
  });

  it('overlay drives the setback constant (inset deeper than full)', () => {
    const full = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    const inset = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'inset', u);
    expect(full[0]!.v).toBeCloseTo(CUP_SETBACK.full, 6);
    expect(inset[0]!.v).toBeCloseTo(CUP_SETBACK.inset, 6);
    expect(CUP_SETBACK.inset).toBeGreaterThan(CUP_SETBACK.full);
  });
});

describe('hingePlateBores — Ø5 plate holes on the side broad face', () => {
  // Side panel native dims: length=H, width=D, thickness=Tc (UNSWAPPED).
  const SIDE_DIMS = { length: 720, width: 560, thickness: 18 };
  // Use the imported LEFT_SIDE_INNER_FACE constant — never re-declare a local 'Top'/'Bottom' literal
  const FRONT_SETBACK = 37;
  const u = hingePositions(716, hingeCountForHeight(716)); // SHARED with the cups

  it('emits 2 plate holes per hinge, PLATE_PAIR_SPACING apart, centered on each hinge u', () => {
    const bores = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, u, FRONT_SETBACK);
    expect(bores).toHaveLength(u.length * 2);
    // group by connectorId and check the pair geometry
    for (let i = 0; i < u.length; i++) {
      const pair = bores.filter((b) => b.connectorId === `hinge-${i}`);
      expect(pair).toHaveLength(2);
      const us = pair.map((b) => b.u).sort((a, c) => a - c);
      expect(us[1]! - us[0]!).toBeCloseTo(PLATE_PAIR_SPACING, 6);
      expect((us[0]! + us[1]!) / 2).toBeCloseTo(u[i]!, 6); // centered on the hinge u
    }
  });

  it('plate holes carry role/kind/diameter/blind depth + sit at v=frontSetback + face.role = LEFT_SIDE_INNER_FACE', () => {
    const bores = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, u, FRONT_SETBACK);
    for (const b of bores) {
      expect(b.role).toBe('hingePlate');
      expect(b.connectorKind).toBe('hinge');
      expect(b.diameter).toBe(PLATE_DIAMETER);
      expect(b.depth).toBe(PLATE_DEPTH);
      expect(b.depth).not.toBe('throughAll');
      expect(b.v).toBeCloseTo(FRONT_SETBACK, 6);
      // face.role must be the imported LEFT_SIDE_INNER_FACE constant — never a local 'Top'/'Bottom'
      expect(b.face.role).toBe(LEFT_SIDE_INNER_FACE);
    }
  });

  it('plate connectorIds match the cup connectorIds (same hinge grouping → plate-Z==cup-Z)', () => {
    const cups = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    const plates = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, u, FRONT_SETBACK);
    const cupIds = new Set(cups.map((b) => b.connectorId));
    for (const p of plates) expect(cupIds.has(p.connectorId)).toBe(true);
  });
});
