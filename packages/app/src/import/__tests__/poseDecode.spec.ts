import { describe, expect, it } from 'vitest';
import { decodePose } from '../poseDecode';
import type { ImporterPose } from '../inventorJsonSchema';

describe('decodePose', () => {
  it('identity pose round-trips', () => {
    const p: ImporterPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
    const out = decodePose(p);
    expect(out.translation).toEqual({ x: 0, y: 0, z: 0 });
    expect(out.quaternion).toEqual([0, 0, 0, 1]);
  });

  it('preserves translation', () => {
    const p: ImporterPose = { translation: { x: 12.5, y: -3, z: 7 }, quaternion: [0, 0, 0, 1] };
    const out = decodePose(p);
    expect(out.translation).toEqual({ x: 12.5, y: -3, z: 7 });
  });

  it('normalizes a denormalized quaternion', () => {
    // (2, 0, 0, 0) is the unnormalized i axis — should normalize to (1, 0, 0, 0)
    const p: ImporterPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [2, 0, 0, 0] };
    const out = decodePose(p);
    expect(out.quaternion[0]).toBeCloseTo(1, 8);
    expect(out.quaternion[3]).toBeCloseTo(0, 8);
  });

  it('throws on zero-length quaternion (cannot normalize)', () => {
    const p: ImporterPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 0] };
    expect(() => decodePose(p)).toThrow(/quaternion/i);
  });
});
