import { describe, it, expect } from 'vitest';
import { EdgePickController, type TessellatedEdge } from '../EdgePickController';
import { canonicalEdgeName } from '@zilventor/shared';

function makeEdge(
  faceA: { featureId: string; role: string; instance?: number },
  faceB: { featureId: string; role: string; instance?: number },
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  dihedralAngle?: number
): TessellatedEdge {
  const base: TessellatedEdge = {
    edgeName: canonicalEdgeName(faceA, faceB),
    segments: [[start, end]],
    faceNames: [faceA, faceB]
  };
  return dihedralAngle === undefined ? base : { ...base, dihedralAngle };
}

describe('EdgePickController Edge mode', () => {
  it('pick returns the hit edge when within tolerance', () => {
    const edge = makeEdge(
      { featureId: 'E1', role: 'top' },
      { featureId: 'E1', role: 'side', instance: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    );
    const ctrl = new EdgePickController();
    ctrl.setCandidates([edge]);
    ctrl.setMode('edge');
    const hit = ctrl.pick({ x: 5, y: 0, z: 0 });
    expect(hit).toEqual([edge.edgeName]);
  });
  it('pick returns null when point is out of tolerance', () => {
    const edge = makeEdge(
      { featureId: 'E1', role: 'top' },
      { featureId: 'E1', role: 'side', instance: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    );
    const ctrl = new EdgePickController();
    ctrl.setCandidates([edge]);
    ctrl.setMode('edge');
    expect(ctrl.pick({ x: 5, y: 50, z: 0 })).toBe(null);
  });
});

describe('EdgePickController Loop mode', () => {
  it('walks tangent-continuous neighbors', () => {
    // 3 colinear edges simulating a tangent chain (end-to-end, same direction).
    const e1 = makeEdge(
      { featureId: 'E1', role: 'a' },
      { featureId: 'E1', role: 'b' },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    );
    const e2 = makeEdge(
      { featureId: 'E1', role: 'b' },
      { featureId: 'E1', role: 'c' },
      { x: 10, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 }
    );
    const e3 = makeEdge(
      { featureId: 'E1', role: 'c' },
      { featureId: 'E1', role: 'd' },
      { x: 20, y: 0, z: 0 },
      { x: 30, y: 0, z: 0 }
    );
    const ctrl = new EdgePickController();
    ctrl.setCandidates([e1, e2, e3]);
    ctrl.setMode('loop');
    const hit = ctrl.pick({ x: 5, y: 0, z: 0 });
    expect(hit).toHaveLength(3);
  });
});

describe('EdgePickController Feature mode', () => {
  it('returns all edges whose faces reference the hit edge featureId', () => {
    const eE1a = makeEdge(
      { featureId: 'E1', role: 'top' },
      { featureId: 'E1', role: 'side', instance: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    );
    const eE1b = makeEdge(
      { featureId: 'E1', role: 'side', instance: 0 },
      { featureId: 'E1', role: 'side', instance: 1 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 }
    );
    const eE2 = makeEdge(
      { featureId: 'E2', role: 'top' },
      { featureId: 'E2', role: 'side', instance: 0 },
      { x: 50, y: 50, z: 0 },
      { x: 60, y: 50, z: 0 }
    );
    const ctrl = new EdgePickController();
    ctrl.setCandidates([eE1a, eE1b, eE2]);
    ctrl.setMode('feature');
    const hit = ctrl.pick({ x: 5, y: 0, z: 0 });
    expect(hit).toHaveLength(2);
  });
});

describe('EdgePickController All-Fillets / All-Rounds modes', () => {
  it('All Fillets mode returns only concave edges', () => {
    const concave = makeEdge(
      { featureId: 'E1', role: 'a' },
      { featureId: 'E1', role: 'b' },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      200
    );
    const convex = makeEdge(
      { featureId: 'E1', role: 'c' },
      { featureId: 'E1', role: 'd' },
      { x: 50, y: 50, z: 0 },
      { x: 60, y: 50, z: 0 },
      160
    );
    const ctrl = new EdgePickController();
    ctrl.setCandidates([concave, convex]);
    ctrl.setMode('all-fillets');
    const hit = ctrl.pick({ x: 5, y: 0, z: 0 });
    expect(hit).toContainEqual(concave.edgeName);
    expect(hit).not.toContainEqual(convex.edgeName);
  });

  it('All Rounds mode returns only convex edges', () => {
    const concave = makeEdge(
      { featureId: 'E1', role: 'a' },
      { featureId: 'E1', role: 'b' },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      200
    );
    const convex = makeEdge(
      { featureId: 'E1', role: 'c' },
      { featureId: 'E1', role: 'd' },
      { x: 50, y: 50, z: 0 },
      { x: 60, y: 50, z: 0 },
      160
    );
    const ctrl = new EdgePickController();
    ctrl.setCandidates([concave, convex]);
    ctrl.setMode('all-rounds');
    // Pick near concave point but All-Rounds filters to convex-only.
    const hit = ctrl.pick({ x: 5, y: 0, z: 0 });
    expect(hit).toContainEqual(convex.edgeName);
    expect(hit).not.toContainEqual(concave.edgeName);
  });
});
