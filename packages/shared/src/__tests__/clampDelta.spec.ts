import { describe, it, expect } from 'vitest';
import { clampDeltaToFaceExtents } from '../clampDelta';
import type { ConnectorMember } from '../connectorCoupling';

// One member on a panel where Top face has uLen=length, vLen=width.
// bore at u=300, diameter=5 (r=2.5). worldDir == Top uDir = {x:1,y:0,z:0}.
// identity quaternion → worldU = {x:1,y:0,z:0}, du=1, dv=0.
function member(u: number, uLen: number): ConnectorMember {
  return {
    bore: {
      id: 'b',
      face: { featureId: 'panel', role: 'Top', instance: 0 },
      u,
      v: 200,
      diameter: 5,
      depth: 12,
      role: 'confirmat-face',
      connectorId: 'c',
      connectorKind: 'confirmat',
      jointDir: { x: 1, y: 0, z: 0 },
    } as ConnectorMember['bore'],
    panelDims: { length: uLen, width: 400, thickness: 18 } as ConnectorMember['panelDims'],
    worldPose: {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1],
    },
  };
}

describe('clampDeltaToFaceExtents', () => {
  // Top face: uDir = {x:1,y:0,z:0}, so worldDir aligns with uDir exactly (du=1, dv=0).
  const worldDir = { x: 1, y: 0, z: 0 };

  it('passes a delta that stays in bounds unchanged', () => {
    // u=300, uLen=600, r=2.5 → allowed [2.5, 597.5], delta=50 → u_new=350 ✓
    expect(clampDeltaToFaceExtents([member(300, 600)], worldDir, 50)).toBeCloseTo(50, 6);
  });

  it('clamps a delta that would push the bore past the far edge (keeps radius margin)', () => {
    // u=300, uLen=600, r=2.5 → max u = 597.5 → max delta = 297.5
    expect(clampDeltaToFaceExtents([member(300, 600)], worldDir, 1000)).toBeCloseTo(297.5, 4);
  });

  it('clamps negative delta at the near edge', () => {
    // u=300, min u = 2.5 → min delta = -297.5
    expect(clampDeltaToFaceExtents([member(300, 600)], worldDir, -1000)).toBeCloseTo(-297.5, 4);
  });

  it('the most-restrictive member governs', () => {
    // member A (u=300, len=600): allows delta up to +297.5
    // member B (u=150, len=320): max u = 317.5 → max delta = 167.5
    const a = member(300, 600);
    const b = member(150, 320);
    expect(clampDeltaToFaceExtents([a, b], worldDir, 1000)).toBeCloseTo(167.5, 4);
  });
});
