// packages/shared/src/drawing/planeFingerprint.test.ts
import { describe, it, expect } from 'vitest';
import { fingerprintPlane } from './planeFingerprint';

describe('fingerprintPlane', () => {
  const plane = {
    origin: { x: 0, y: 0, z: 5 },
    normal: { x: 0, y: 0, z: 1 },
  };

  it('identical planes with float noise → same fingerprint', () => {
    const planeA = { origin: { x: 0,         y: 0,         z: 5 },         normal: { x: 0, y: 0, z: 1 } };
    const planeB = { origin: { x: 1.2e-10,   y: -5.0e-11,  z: 4.9999999 }, normal: { x: 0, y: 0, z: 1.0000001 } };
    // 1e-3 mm rounding: 5 vs 4.9999999 → rounds to 5.000 same; 1e-10 → 0.000 same
    expect(fingerprintPlane(planeA)).toBe(fingerprintPlane(planeB));
  });

  it('mirrored normal → different fingerprint', () => {
    const pos = { origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z:  1 } };
    const neg = { origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: -1 } };
    expect(fingerprintPlane(pos)).not.toBe(fingerprintPlane(neg));
  });

  it('translated plane → different fingerprint', () => {
    const a = { origin: { x: 0, y: 0, z: 5  }, normal: { x: 0, y: 0, z: 1 } };
    const b = { origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
    expect(fingerprintPlane(a)).not.toBe(fingerprintPlane(b));
  });

  it('serialize/deserialize → stable fingerprint', () => {
    const fp1 = fingerprintPlane(plane);
    const restored = JSON.parse(JSON.stringify(plane));
    const fp2 = fingerprintPlane(restored);
    expect(fp1).toBe(fp2);
  });
});
