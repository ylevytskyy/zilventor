import { describe, it, expect } from 'vitest';
import { columnPositions, shelfPinGrid, DEFAULT_SHELF_PIN_PARAMS } from './shelfPinGrid';
import { buildBaseCabinet } from './cabinets';
import type { BaseCabinetParams } from './cabinets';
import type { MaterialEntry } from './material';
import { face2DFrame } from './bore';

describe('columnPositions — centered system-32 ladder', () => {
  it('steps at exactly `pitch` between consecutive holes', () => {
    const xs = columnPositions(64, 656, 32); // span 592 = 18*32 + 16
    for (let i = 1; i < xs.length; i++) {
      const prev = xs[i - 1] ?? 0;
      const curr = xs[i] ?? 0;
      expect(curr - prev).toBeCloseTo(32, 9);
    }
  });

  it('centers the run so leading and trailing clearances are equal', () => {
    const start = 64, end = 656, pitch = 32;
    const xs = columnPositions(start, end, pitch);
    const first = xs[0] ?? start;
    const last = xs[xs.length - 1] ?? end;
    const leading = first - start;
    const trailing = end - last;
    expect(leading).toBeCloseTo(trailing, 9);
  });

  it('keeps every hole inside [start, end]', () => {
    const start = 64, end = 656, pitch = 32;
    const xs = columnPositions(start, end, pitch);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(start - 1e-9);
      expect(x).toBeLessThanOrEqual(end + 1e-9);
    }
  });

  it('places exactly floor(span/pitch)+1 holes', () => {
    // span = 656-64 = 592; floor(592/32)=18 → 19 holes
    expect(columnPositions(64, 656, 32)).toHaveLength(19);
  });

  it('returns a single centered hole when span < pitch', () => {
    const xs = columnPositions(100, 120, 32); // span 20 < 32
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(110, 9); // midpoint of [100,120]
  });

  it('returns a single hole at start when span === 0', () => {
    expect(columnPositions(50, 50, 32)).toEqual([50]);
  });
});

// Build a REAL side panel via buildBaseCabinet and read its native dims.
// Side panel native frame = {length:H, width:D, thickness:Tc} (baseCabinet.ts:30-43).
const CARCASS: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const BACK: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
const REGISTRY: ReadonlyArray<MaterialEntry> = [CARCASS, BACK];
const PARAMS: BaseCabinetParams = {
  name: 'C', width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50, shelfCount: 0,
  carcassMaterialId: 'm-birch-18', backMaterialId: 'm-hb-6', bandMaterialId: null,
};

function sidePanelDims(): { length: number; width: number; thickness: number } {
  const out = buildBaseCabinet(PARAMS, REGISTRY);
  const left = out.panels.find((p) => p.role === 'leftSide')!;
  const lit = (e: { kind: string; value?: number }) => (e as { value: number }).value;
  return {
    length: lit(left.panel.length),      // H = 720
    width: lit(left.panel.width),        // D = 560
    thickness: lit(left.panel.thickness), // Tc = 18
  };
}

describe('shelfPinGrid — 2-column system-32 grid on a side inner broad face', () => {
  const dims = sidePanelDims(); // { length:720, width:560, thickness:18 }
  const p = DEFAULT_SHELF_PIN_PARAMS;

  it('uses real side-panel native dims (sanity)', () => {
    expect(dims).toEqual({ length: 720, width: 560, thickness: 18 });
  });

  it('emits 2 columns × (ladder length) bores on the Top inner face', () => {
    const bores = shelfPinGrid(dims, 'Top', p);
    const ladder = columnPositions(p.bottomMargin, dims.length - p.topMargin, p.pitch);
    expect(bores).toHaveLength(2 * ladder.length);
  });

  it('places the front column at v=frontSetback and the back column at v=width−backSetback', () => {
    const bores = shelfPinGrid(dims, 'Top', p);
    const front = bores.filter((b) => b.connectorId === 'pin-col-front');
    const back = bores.filter((b) => b.connectorId === 'pin-col-back');
    expect(front.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    for (const b of front) expect(b.v).toBeCloseTo(p.frontSetback, 9);           // 37
    for (const b of back) expect(b.v).toBeCloseTo(dims.width - p.backSetback, 9); // 560-37 = 523
  });

  it('steps holes in u from bottomMargin..length−topMargin at pitch=32', () => {
    const bores = shelfPinGrid(dims, 'Top', p);
    const front = bores.filter((b) => b.connectorId === 'pin-col-front').map((b) => b.u);
    const expected = columnPositions(p.bottomMargin, dims.length - p.topMargin, p.pitch);
    expect(front).toEqual(expected.map((u) => expect.closeTo(u, 9)));
    for (let i = 1; i < front.length; i++) {
      const prev = front[i - 1] ?? 0;
      const curr = front[i] ?? 0;
      expect(curr - prev).toBeCloseTo(32, 9);
    }
  });

  it('keeps every bore in-bounds: u∈[0,H], v∈[0,D]', () => {
    const bores = shelfPinGrid(dims, 'Top', p);
    for (const b of bores) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(dims.length);  // H
      expect(b.v).toBeGreaterThanOrEqual(0);
      expect(b.v).toBeLessThanOrEqual(dims.width);   // D
    }
  });

  it('emits BLIND Ø5 shelfPin bores with correct role/kind (never throughAll)', () => {
    const bores = shelfPinGrid(dims, 'Top', p);
    for (const b of bores) {
      expect(b.diameter).toBe(p.diameter);          // 5
      expect(b.depth).toBe(p.depth);                // 13 (blind number, never 'throughAll')
      expect(typeof b.depth).toBe('number');
      expect(b.depth).toBeLessThan(dims.thickness); // 13 < 18 → blind
      expect(b.role).toBe('shelfPin-system32');
      expect(b.connectorKind).toBe('shelfPin');
      expect(['pin-col-front', 'pin-col-back']).toContain(b.connectorId);
    }
  });

  it('targets the requested broad inner face and panel feature', () => {
    const bores = shelfPinGrid(dims, 'Top', p);
    for (const b of bores) {
      expect(b.face).toEqual({ featureId: 'panel', role: 'Top', instance: 0 });
    }
    const bottomBores = shelfPinGrid(dims, 'Bottom', p);
    for (const b of bottomBores) expect(b.face.role).toBe('Bottom');
  });

  it('emits unique deterministic ids', () => {
    const bores = shelfPinGrid(dims, 'Top', p);
    const ids = bores.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('honors columns:1 (front column only)', () => {
    const bores = shelfPinGrid(dims, 'Top', { ...p, columns: 1 });
    const ladder = columnPositions(p.bottomMargin, dims.length - p.topMargin, p.pitch);
    expect(bores).toHaveLength(ladder.length);
    for (const b of bores) expect(b.connectorId).toBe('pin-col-front');
  });

  it('produces a world point on the broad face via face2DFrame (u→height, v→depth)', () => {
    // Cross-check that authoring (u,v) against native dims on Top lands where
    // bake/markers will read it (CONTRACT §D): u spans 0..H along +X, v spans 0..D along +Y.
    const frame = face2DFrame(dims, 'Top'); // origin (-360,-280,18), uDir +X, vDir +Y
    const bores = shelfPinGrid(dims, 'Top', p);
    expect(bores.length).toBeGreaterThan(0);
    const b = bores[0]!; // non-null: we just asserted length > 0
    const P = {
      x: frame.origin.x + b.u * frame.uDir.x + b.v * frame.vDir.x,
      y: frame.origin.y + b.u * frame.uDir.y + b.v * frame.vDir.y,
      z: frame.origin.z + b.u * frame.uDir.z + b.v * frame.vDir.z,
    };
    // u is a height offset along X within [-H/2, H/2]; v a depth offset along Y within [-D/2, D/2]; on the +Z broad face.
    expect(P.x).toBeGreaterThanOrEqual(-dims.length / 2 - 1e-9);
    expect(P.x).toBeLessThanOrEqual(dims.length / 2 + 1e-9);
    expect(P.y).toBeGreaterThanOrEqual(-dims.width / 2 - 1e-9);
    expect(P.y).toBeLessThanOrEqual(dims.width / 2 + 1e-9);
    expect(P.z).toBeCloseTo(dims.thickness, 9); // on the Top (z=Tc) broad face
  });
});
