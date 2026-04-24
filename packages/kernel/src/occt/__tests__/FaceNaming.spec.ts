import { describe, it, expect } from 'vitest';
import { namedFace, attachName, faceNamesEqual, type NamedShape } from '../FaceNaming';
import { canonicalEdgeName } from '@zilventor/shared';

describe('FaceNaming helpers (unit — no OCCT)', () => {
  it('namedFace constructs a FaceName with instance default 0', () => {
    expect(namedFace('E1', 'top')).toEqual({ featureId: 'E1', role: 'top', instance: 0 });
    expect(namedFace('E1', 'side', 2)).toEqual({ featureId: 'E1', role: 'side', instance: 2 });
  });

  it('faceNamesEqual does deep equality', () => {
    expect(faceNamesEqual(namedFace('E1', 'top'), namedFace('E1', 'top'))).toBe(true);
    expect(faceNamesEqual(namedFace('E1', 'top'), namedFace('E1', 'bottom'))).toBe(false);
    expect(faceNamesEqual(namedFace('E1', 'side', 0), namedFace('E1', 'side', 1))).toBe(false);
  });

  it('attachName pushes into faceNames array', () => {
    const fakeShape = { __brand: 'OcctShape' as const, handle: null };
    const nm: NamedShape = { shape: fakeShape, faceNames: [] };
    const fakeFace = { fake: true };
    attachName(nm, fakeFace, namedFace('E1', 'top'));
    expect(nm.faceNames).toHaveLength(1);
    expect(nm.faceNames[0]!.name.role).toBe('top');
  });

  it('canonicalEdgeName is re-exported and symmetric', () => {
    const e1 = canonicalEdgeName(namedFace('E1', 'top'), namedFace('E1', 'side'));
    const e2 = canonicalEdgeName(namedFace('E1', 'side'), namedFace('E1', 'top'));
    expect(e1).toEqual(e2);
  });
});
