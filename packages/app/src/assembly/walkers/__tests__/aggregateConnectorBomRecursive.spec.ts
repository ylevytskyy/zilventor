import { describe, it, expect } from 'vitest';
import { aggregateConnectorBomRecursive } from '../aggregateConnectorBomRecursive';
import type { AssemblyDocument, ComponentInstance, BoreOp, PartInfo } from '@zilventor/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBore(overrides: Partial<BoreOp> & { id: string; role: BoreOp['role']; connectorId: string; connectorKind: BoreOp['connectorKind'] }): BoreOp {
  return {
    face: { featureId: 'panel', role: 'Top', instance: 0 },
    u: 100, v: 50, diameter: 7, depth: 34,
    ...overrides,
  };
}

function cmp(id: string, partPath: string): ComponentInstance {
  return { id, partPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true };
}

function asm(id: string, components: ComponentInstance[]): AssemblyDocument {
  return {
    id, name: id, units: 'mm',
    parameters: {}, components, constraints: [],
    groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
    colorOverrides: {},
  } as unknown as AssemblyDocument;
}

function cacheOf(entries: Array<[string, AssemblyDocument]>) {
  return {
    get: (path: string) => {
      const found = entries.find(([p]) => p === path);
      return found ? { kind: 'ok' as const, doc: found[1], partPath: path } : undefined;
    },
  };
}

function partInfoOf(entries: Array<[string, string]>): Map<string, PartInfo> {
  return new Map(entries.map(([k, v]) => [k, { name: v }]));
}

// ─── Confirmat bores: 2 panels inside one cabinet .ziasm ─────────────────────

const CONFIRMAT_FACE_BORE = makeBore({ id: 'cf-0-A-0', role: 'confirmat-face', connectorId: 'confirmat-0', connectorKind: 'confirmat' });
const CONFIRMAT_EDGE_BORE = makeBore({ id: 'cf-0-B-0', role: 'confirmat-edge', connectorId: 'confirmat-0', connectorKind: 'confirmat' });

describe('aggregateConnectorBomRecursive', () => {

  // ── C.2.1 ── confirmat shared by 2 panels inside same .ziasm → counted once
  it('confirmat connectorId shared across 2 panel docs inside one cabinet counts as 1 confirmat', () => {
    const cabinet = asm('cab', [
      cmp('side',  'parts/side.zipt'),
      cmp('back',  'parts/back.zipt'),
    ]);
    const root = asm('root', [cmp('cab-inst', 'cabinets/cab.ziasm')]);

    // Each panel doc has ONE bore from the SAME connectorId='confirmat-0'
    const partBores = new Map<string, BoreOp[]>([
      ['parts/side.zipt', [CONFIRMAT_FACE_BORE]],
      ['parts/back.zipt', [CONFIRMAT_EDGE_BORE]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root,
      cacheOf([['cabinets/cab.ziasm', cabinet]]),
      partBores,
      partInfoOf([]),
    );

    const confirmats = rows.filter((r) => r.kind === 'confirmat');
    expect(confirmats).toHaveLength(1);
    expect(confirmats[0]!.qty).toBe(1);
  });

  // ── C.2.2 ── FLIP-TO-RED: without scope-key dedup, same connectorId in two panel docs
  // produces qty=2 instead of qty=1. This test verifies dedup IS in place by
  // asserting qty===1 (if dedup were removed, qty would be 2).
  it('DEDUP REQUIRED: removing scope-key dedup would yield qty=2 — assert qty=1 proves dedup', () => {
    const cabinet = asm('cab', [
      cmp('c1', 'parts/side.zipt'),
      cmp('c2', 'parts/back.zipt'),
    ]);
    const root = asm('root', [cmp('ci', 'cabinets/cab.ziasm')]);
    const partBores = new Map<string, BoreOp[]>([
      ['parts/side.zipt', [CONFIRMAT_FACE_BORE]],   // connectorId='confirmat-0'
      ['parts/back.zipt', [CONFIRMAT_EDGE_BORE]],   // same connectorId='confirmat-0'
    ]);
    const rows = aggregateConnectorBomRecursive(
      root, cacheOf([['cabinets/cab.ziasm', cabinet]]), partBores, partInfoOf([]),
    );
    // Without dedup: naïve per-bore count → confirmat.qty would be 2.
    // With dedup: Set<`${scopeKey}:confirmat:confirmat-0`> → qty=1.
    expect(rows.find((r) => r.kind === 'confirmat')!.qty).toBe(1);
  });

  // ── C.2.3 ── hinge counted once per connector (2 bores: cup + plate share connectorId)
  it('hinge cup+plate bores sharing connectorId inside same cabinet count as 1 hinge', () => {
    const hingeCup   = makeBore({ id: 'h-0-cup',   role: 'hingeCup',   connectorId: 'hinge-0', connectorKind: 'hinge' });
    const hingePlate = makeBore({ id: 'h-0-plate', role: 'hingePlate', connectorId: 'hinge-0', connectorKind: 'hinge' });
    const cabinet = asm('cab', [
      cmp('door',  'parts/door.zipt'),
      cmp('side',  'parts/side.zipt'),
    ]);
    const root = asm('root', [cmp('ci', 'cabinets/cab.ziasm')]);
    const partBores = new Map<string, BoreOp[]>([
      ['parts/door.zipt', [hingeCup]],
      ['parts/side.zipt', [hingePlate]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root, cacheOf([['cabinets/cab.ziasm', cabinet]]), partBores, partInfoOf([]),
    );
    const hinges = rows.filter((r) => r.kind === 'hinge');
    expect(hinges).toHaveLength(1);
    expect(hinges[0]!.qty).toBe(1);
  });

  // ── C.2.4 ── ×N cabinet instances: 2 identical cabinets → 2×confirmat
  it('two cabinet instances in root asm double the fastener counts', () => {
    const cabinet = asm('cab', [
      cmp('side', 'parts/side.zipt'),
      cmp('back', 'parts/back.zipt'),
    ]);
    const root = asm('root', [
      cmp('cab1', 'cabinets/cab.ziasm'),
      cmp('cab2', 'cabinets/cab.ziasm'),
    ]);
    const partBores = new Map<string, BoreOp[]>([
      ['parts/side.zipt', [CONFIRMAT_FACE_BORE]],
      ['parts/back.zipt', [CONFIRMAT_EDGE_BORE]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root, cacheOf([['cabinets/cab.ziasm', cabinet]]), partBores, partInfoOf([]),
    );
    const confirmats = rows.filter((r) => r.kind === 'confirmat');
    expect(confirmats).toHaveLength(1);
    expect(confirmats[0]!.qty).toBe(2);  // 1 per cabinet × 2 cabinets
  });

  // ── C.2.5 ── shelf pins counted per bore (2 columns × 5 holes = 10 pins)
  it('shelfPin bores are counted per-hole (not per-connectorId): 2×5 holes = 10 pins', () => {
    const makeShelfPin = (i: number): BoreOp =>
      makeBore({ id: `pin-col-front-${i}`, role: 'shelfPin-system32', connectorId: 'pin-col-front', connectorKind: 'shelfPin' });
    const makeShelfPinBack = (i: number): BoreOp =>
      makeBore({ id: `pin-col-back-${i}`, role: 'shelfPin-system32', connectorId: 'pin-col-back', connectorKind: 'shelfPin' });

    const sideBores: BoreOp[] = [
      ...Array.from({ length: 5 }, (_, i) => makeShelfPin(i)),
      ...Array.from({ length: 5 }, (_, i) => makeShelfPinBack(i)),
    ];

    const cabinet = asm('cab', [cmp('side', 'parts/side.zipt')]);
    const root = asm('root', [cmp('ci', 'cabinets/cab.ziasm')]);
    const partBores = new Map<string, BoreOp[]>([['parts/side.zipt', sideBores]]);

    const rows = aggregateConnectorBomRecursive(
      root, cacheOf([['cabinets/cab.ziasm', cabinet]]), partBores, partInfoOf([]),
    );
    const pins = rows.filter((r) => r.kind === 'shelfPin');
    expect(pins).toHaveLength(1);
    expect(pins[0]!.qty).toBe(10);   // 5 front + 5 back = 10
  });

  // ── C.2.6 ── shelf pins per-hole: two panel instances each with 3 pins = 6 total
  it('two instances of the same panel with 3 shelfPin bores each → 6 pins total', () => {
    const makeSP = (i: number): BoreOp =>
      makeBore({ id: `pin-col-front-${i}`, role: 'shelfPin-system32', connectorId: 'pin-col-front', connectorKind: 'shelfPin' });
    const sideBores: BoreOp[] = Array.from({ length: 3 }, (_, i) => makeSP(i));
    // Two separate instances of the same part (like two side panels in a cabinet)
    const cabinet = asm('cab', [cmp('s1', 'parts/side.zipt'), cmp('s2', 'parts/side.zipt')]);
    const root = asm('root', [cmp('ci', 'cabinets/cab.ziasm')]);
    const partBores = new Map<string, BoreOp[]>([['parts/side.zipt', sideBores]]);

    const rows = aggregateConnectorBomRecursive(
      root, cacheOf([['cabinets/cab.ziasm', cabinet]]), partBores, partInfoOf([]),
    );
    const pins = rows.filter((r) => r.kind === 'shelfPin');
    expect(pins).toHaveLength(1);
    expect(pins[0]!.qty).toBe(6);   // 3 bores × 2 instances
  });

  // ── C.2.7 ── two distinct cabinets; confirmat connectorIds are independent (no cross-cabinet dedup)
  it('same connectorId string in two different .ziasm scopes counts as 2 (different scope keys)', () => {
    // Both cabinets generate confirmat-0, but they are in different .ziasm scopes
    const cabA = asm('cabA', [cmp('side', 'parts/sideA.zipt'), cmp('back', 'parts/backA.zipt')]);
    const cabB = asm('cabB', [cmp('side', 'parts/sideB.zipt'), cmp('back', 'parts/backB.zipt')]);
    const root = asm('root', [
      cmp('a', 'cabs/A.ziasm'),
      cmp('b', 'cabs/B.ziasm'),
    ]);
    const partBores = new Map<string, BoreOp[]>([
      ['parts/sideA.zipt', [CONFIRMAT_FACE_BORE]],
      ['parts/backA.zipt', [CONFIRMAT_EDGE_BORE]],
      ['parts/sideB.zipt', [CONFIRMAT_FACE_BORE]],
      ['parts/backB.zipt', [CONFIRMAT_EDGE_BORE]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root,
      cacheOf([['cabs/A.ziasm', cabA], ['cabs/B.ziasm', cabB]]),
      partBores,
      partInfoOf([]),
    );
    const confirmats = rows.filter((r) => r.kind === 'confirmat');
    expect(confirmats).toHaveLength(1);
    // scope key for A ≠ scope key for B → each cabinet contributes 1 confirmat
    expect(confirmats[0]!.qty).toBe(2);
  });

  // ── C.2.8 ── result is sorted by kind; empty assembly returns []
  it('returns empty array when no bores are present', () => {
    const root = asm('root', [cmp('c1', 'parts/plain.zipt')]);
    const rows = aggregateConnectorBomRecursive(
      root, cacheOf([]), new Map(), partInfoOf([]),
    );
    expect(rows).toEqual([]);
  });

  it('result rows are sorted by kind (confirmat < dowel < hinge < minifix < shelfPin)', () => {
    const hingeCup = makeBore({ id: 'h-0', role: 'hingeCup', connectorId: 'hinge-0', connectorKind: 'hinge' });
    const dowelFace = makeBore({ id: 'd-0', role: 'dowel-face', connectorId: 'dowel-0', connectorKind: 'dowel' });
    const cabinet = asm('cab', [
      cmp('door', 'parts/door.zipt'),
      cmp('top', 'parts/top.zipt'),
      cmp('side', 'parts/side.zipt'),
      cmp('back', 'parts/back.zipt'),
    ]);
    const root = asm('root', [cmp('ci', 'cab.ziasm')]);
    const partBores = new Map<string, BoreOp[]>([
      ['parts/door.zipt', [hingeCup]],
      ['parts/top.zipt', [CONFIRMAT_FACE_BORE]],
      ['parts/side.zipt', [dowelFace]],
      ['parts/back.zipt', [CONFIRMAT_EDGE_BORE]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root, cacheOf([['cab.ziasm', cabinet]]), partBores, partInfoOf([]),
    );
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toEqual([...kinds].sort());
  });

  // ── C.2.9 ── TWO-LEVEL nesting: root → outer .ziasm → inner .ziasm → parts
  // The nearest enclosing .ziasm for parts inside the INNER assembly is the INNER instance,
  // not the outer one. A confirmat whose two panels are both inside the inner .ziasm counts once.
  it('two-level nesting: nearest enclosing .ziasm scope is the inner instance, not outer', () => {
    // root → outerCab (outer.ziasm) → innerCab (inner.ziasm) → {side, back}
    // Both side + back are inside inner.ziasm → same scope key → confirmat-0 counted once.
    const innerCabAsm = asm('inner', [
      cmp('side', 'parts/side.zipt'),
      cmp('back', 'parts/back.zipt'),
    ]);
    const outerCabAsm = asm('outer', [
      cmp('innerInst', 'inner/cab.ziasm'),
    ]);
    const root = asm('root', [cmp('outerInst', 'outer/cab.ziasm')]);

    const partBores = new Map<string, BoreOp[]>([
      ['parts/side.zipt', [CONFIRMAT_FACE_BORE]],
      ['parts/back.zipt', [CONFIRMAT_EDGE_BORE]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root,
      cacheOf([
        ['outer/cab.ziasm', outerCabAsm],
        ['inner/cab.ziasm', innerCabAsm],
      ]),
      partBores,
      partInfoOf([]),
    );

    const confirmats = rows.filter((r) => r.kind === 'confirmat');
    expect(confirmats).toHaveLength(1);
    expect(confirmats[0]!.qty).toBe(1); // one inner instance → one confirmat

    // DEDUP CHECK: if scoping were at the outer level instead of inner, the 2-panel
    // confirmat would still count as 1 — but what matters is that it does NOT become 2.
    // The critical test is the ×2 inner scenario below.
  });

  it('two-level nesting ×2: outer .ziasm with 2 inner cabinet instances → 2× confirmat', () => {
    const innerCabAsm = asm('inner', [
      cmp('side', 'parts/side.zipt'),
      cmp('back', 'parts/back.zipt'),
    ]);
    // Outer cabinet has TWO instances of the same inner cabinet
    const outerCabAsm = asm('outer', [
      cmp('innerInstA', 'inner/cab.ziasm'),
      cmp('innerInstB', 'inner/cab.ziasm'),
    ]);
    const root = asm('root', [cmp('outerInst', 'outer/cab.ziasm')]);

    const partBores = new Map<string, BoreOp[]>([
      ['parts/side.zipt', [CONFIRMAT_FACE_BORE]],
      ['parts/back.zipt', [CONFIRMAT_EDGE_BORE]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root,
      cacheOf([
        ['outer/cab.ziasm', outerCabAsm],
        ['inner/cab.ziasm', innerCabAsm],
      ]),
      partBores,
      partInfoOf([]),
    );

    const confirmats = rows.filter((r) => r.kind === 'confirmat');
    expect(confirmats).toHaveLength(1);
    // innerInstA's (side,back) share scope key → 1 confirmat
    // innerInstB's (side,back) share a DIFFERENT scope key → another 1 confirmat
    // Total = 2. Proves the inner scope is what matters, not the outer.
    expect(confirmats[0]!.qty).toBe(2);
  });

  it('mixed fasteners + shelfPins in one assembly: confirms independent accumulation', () => {
    // A cabinet with: 1 confirmat joint (side+back), 1 hinge (door+side), 4 shelf pins (side)
    const hingeCup   = makeBore({ id: 'h-0-cup',   role: 'hingeCup',   connectorId: 'hinge-0', connectorKind: 'hinge' });
    const hingePlate = makeBore({ id: 'h-0-plate', role: 'hingePlate', connectorId: 'hinge-0', connectorKind: 'hinge' });
    const shelfPins  = Array.from({ length: 4 }, (_, i) =>
      makeBore({ id: `pin-front-${i}`, role: 'shelfPin-system32', connectorId: 'pin-col-front', connectorKind: 'shelfPin' }),
    );

    const cabinet = asm('cab', [
      cmp('side',  'parts/side.zipt'),
      cmp('back',  'parts/back.zipt'),
      cmp('door',  'parts/door.zipt'),
      cmp('side2', 'parts/side2.zipt'),  // second side for hinge plate + shelf pins
    ]);
    const root = asm('root', [cmp('ci', 'cabinets/cab.ziasm')]);

    const partBores = new Map<string, BoreOp[]>([
      ['parts/side.zipt',  [CONFIRMAT_FACE_BORE, ...shelfPins]],  // confirmat face + 4 shelf pins
      ['parts/back.zipt',  [CONFIRMAT_EDGE_BORE]],                // confirmat edge
      ['parts/door.zipt',  [hingeCup]],                           // hinge cup
      ['parts/side2.zipt', [hingePlate]],                         // hinge plate
    ]);

    const rows = aggregateConnectorBomRecursive(
      root,
      cacheOf([['cabinets/cab.ziasm', cabinet]]),
      partBores,
      partInfoOf([]),
    );

    // 1 confirmat (face+edge in same scope)
    const confirmats = rows.filter((r) => r.kind === 'confirmat');
    expect(confirmats).toHaveLength(1);
    expect(confirmats[0]!.qty).toBe(1);

    // 1 hinge (cup+plate in same scope)
    const hinges = rows.filter((r) => r.kind === 'hinge');
    expect(hinges).toHaveLength(1);
    expect(hinges[0]!.qty).toBe(1);

    // 4 shelf pins (per-hole, not per-connectorId)
    const pins = rows.filter((r) => r.kind === 'shelfPin');
    expect(pins).toHaveLength(1);
    expect(pins[0]!.qty).toBe(4);

    // Total 3 distinct kinds in result
    expect(rows.length).toBe(3);

    // FLIP-TO-RED for shelf pins: if shelfPins were deduplicated by connectorId ('pin-col-front'),
    // pins[0]!.qty would be 1 (one distinct connectorId) instead of 4 (one per bore).
    // This assertion proves the per-hole counting is in place.
    expect(pins[0]!.qty).not.toBe(1);
  });

  // Correction 3 — per task instruction: expect nameKey not name
  it('ConnectorBomRawRow.nameKey is a catalog key (not a resolved display string)', () => {
    // The aggregator returns nameKey; the hook later resolves it via t(nameKey).
    // This test verifies the aggregator returns nameKey='bom.connector.confirmat', not a resolved name.
    const cabinet = asm('cab', [cmp('side', 'p/side.zipt'), cmp('back', 'p/back.zipt')]);
    const root = asm('root', [cmp('ci', 'cabs/cab.ziasm')]);
    const partBores = new Map<string, BoreOp[]>([
      ['p/side.zipt', [CONFIRMAT_FACE_BORE]],
      ['p/back.zipt', [CONFIRMAT_EDGE_BORE]],
    ]);
    const rows = aggregateConnectorBomRecursive(
      root,
      cacheOf([['cabs/cab.ziasm', cabinet]]),
      partBores,
      partInfoOf([]),
    );
    const confirmat = rows.find((r) => r.kind === 'confirmat')!;
    // Must be the i18n key, not a resolved display string
    expect(confirmat.nameKey).toBe('bom.connector.confirmat');
    // Must NOT be an empty string
    expect(confirmat.nameKey.length).toBeGreaterThan(0);
  });
});
