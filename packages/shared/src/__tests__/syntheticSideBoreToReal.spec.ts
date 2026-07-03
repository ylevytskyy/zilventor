import { describe, it, expect } from 'vitest';
import { syntheticSideBoreToReal, face2DFrame } from '../bore';
import type { BoreOp } from '../bore';

/**
 * LOCKING TEST — bore-aside-swapuv slice 2 residual frame mismatch.
 *
 * GenerateCarcassBoresCommand computes side-panel (leftSide/rightSide) A-side bores
 * against a SYNTHETIC length<->thickness-swapped dims frame (needed for jointMath's
 * worldAABB inference), then historically persisted the resulting face.role ('Left'/
 * 'Right') VERBATIM onto the panel's REAL, unswapped PartDocument — where 'Left'/'Right'
 * name a physically different (thin edge, not flat) face. syntheticSideBoreToReal is the
 * pure remap that fixes this at persistence time: 'Right'->'Top', 'Left'->'Bottom', u/v
 * unchanged (see the derivation comment on the function itself).
 */
function realCabinetDims() {
  return { length: 720, width: 560, thickness: 18 }; // leftSide PartDocument's own dims
}
function syntheticSideDims() {
  return { length: 18, width: 560, thickness: 720 }; // L<->T-swapped, fed to jointMath
}

function makeBore(role: 'Left' | 'Right' | 'Top' | 'Bottom', u: number, v: number): BoreOp {
  return {
    id: 'probe', face: { featureId: 'panel', role, instance: 0 },
    u, v, diameter: 7, depth: 'throughAll', role: 'confirmat-face',
    connectorId: 'confirmat-0', connectorKind: 'confirmat',
  };
}

describe('syntheticSideBoreToReal', () => {
  it('renames Right -> Top and leaves u/v unchanged', () => {
    const bore = makeBore('Right', 9, 60);
    const mapped = syntheticSideBoreToReal(bore);
    expect(mapped.face.role).toBe('Top');
    expect(mapped.u).toBe(9);
    expect(mapped.v).toBe(60);
  });

  it('renames Left -> Bottom and leaves u/v unchanged', () => {
    const bore = makeBore('Left', 9, 277);
    const mapped = syntheticSideBoreToReal(bore);
    expect(mapped.face.role).toBe('Bottom');
    expect(mapped.u).toBe(9);
    expect(mapped.v).toBe(277);
  });

  it('leaves non-Left/Right roles (e.g. end-panel bores) unchanged', () => {
    const bore = makeBore('Top', 9, 60);
    const mapped = syntheticSideBoreToReal(bore);
    expect(mapped).toEqual(bore);
  });

  it('does not mutate the input bore', () => {
    const bore = makeBore('Right', 9, 60);
    syntheticSideBoreToReal(bore);
    expect(bore.face.role).toBe('Right');
  });

  describe('round-trip property: synthetic-frame physical point == real-frame physical point', () => {
    // The proper (det=+1) rotation relating the two frames, per the function's derivation
    // comment: real_x = synthetic_z - Lr/2, real_y = -synthetic_y, real_z = synthetic_x + Ts/2.
    function toReal(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
      const Lr = 720, Ts = 18;
      return { x: p.z - Lr / 2, y: -p.y, z: p.x + Ts / 2 };
    }

    it('Right/Top: physical point matches under the frame-correspondence rotation', () => {
      for (const [u, v] of [[9, 60], [9, 277], [9, 494]] as const) {
        const synFrame = face2DFrame(syntheticSideDims(), 'Right');
        const synPoint = {
          x: synFrame.origin.x + u * synFrame.uDir.x + v * synFrame.vDir.x,
          y: synFrame.origin.y + u * synFrame.uDir.y + v * synFrame.vDir.y,
          z: synFrame.origin.z + u * synFrame.uDir.z + v * synFrame.vDir.z,
        };
        const mapped = syntheticSideBoreToReal(makeBore('Right', u, v));
        const realFrame = face2DFrame(realCabinetDims(), mapped.face.role as 'Top' | 'Bottom');
        const realPoint = {
          x: realFrame.origin.x + mapped.u * realFrame.uDir.x + mapped.v * realFrame.vDir.x,
          y: realFrame.origin.y + mapped.u * realFrame.uDir.y + mapped.v * realFrame.vDir.y,
          z: realFrame.origin.z + mapped.u * realFrame.uDir.z + mapped.v * realFrame.vDir.z,
        };
        const expected = toReal(synPoint);
        expect(realPoint.x).toBeCloseTo(expected.x, 6);
        expect(realPoint.y).toBeCloseTo(expected.y, 6);
        expect(realPoint.z).toBeCloseTo(expected.z, 6);
      }
    });

    it('Left/Bottom: physical point matches under the frame-correspondence rotation', () => {
      for (const [u, v] of [[9, 60], [9, 277], [9, 494]] as const) {
        const synFrame = face2DFrame(syntheticSideDims(), 'Left');
        const synPoint = {
          x: synFrame.origin.x + u * synFrame.uDir.x + v * synFrame.vDir.x,
          y: synFrame.origin.y + u * synFrame.uDir.y + v * synFrame.vDir.y,
          z: synFrame.origin.z + u * synFrame.uDir.z + v * synFrame.vDir.z,
        };
        const mapped = syntheticSideBoreToReal(makeBore('Left', u, v));
        const realFrame = face2DFrame(realCabinetDims(), mapped.face.role as 'Top' | 'Bottom');
        const realPoint = {
          x: realFrame.origin.x + mapped.u * realFrame.uDir.x + mapped.v * realFrame.vDir.x,
          y: realFrame.origin.y + mapped.u * realFrame.uDir.y + mapped.v * realFrame.vDir.y,
          z: realFrame.origin.z + mapped.u * realFrame.uDir.z + mapped.v * realFrame.vDir.z,
        };
        const expected = toReal(synPoint);
        expect(realPoint.x).toBeCloseTo(expected.x, 6);
        expect(realPoint.y).toBeCloseTo(expected.y, 6);
        expect(realPoint.z).toBeCloseTo(expected.z, 6);
      }
    });
  });
});
