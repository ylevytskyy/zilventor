import { describe, it, expect } from 'vitest';
import {
  generateConfirmat, generateMinifix, generateDowel,
  type JointInput, type BoringParams,
} from '../connectorCatalog';

const defaults: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };

// A 700mm joint along +X at the shared edge. A = face-drilled side panel,
// B = end-drilled bottom panel. Dims/poses are illustrative (generators are
// pure over jointLen + faceA/endB; pose feeds frame placement downstream).
function joint(len = 700): JointInput {
  return {
    line: { p0: { x: 0, y: 0, z: 0 }, p1: { x: len, y: 0, z: 0 } },
    panelA: { dims: { length: 800, width: 500, thickness: 18 },
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    panelB: { dims: { length: len, width: 500, thickness: 18 },
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    faceA: 'Left',
    endB: 'Top',
  };
}

describe('count/spacing math (via confirmat)', () => {
  it('700mm joint, defaults → ceil((700-120)/250)+1 = 4 confirmats per side', () => {
    const r = generateConfirmat(joint(700), defaults);
    expect(r.boresA).toHaveLength(4);
    expect(r.boresB).toHaveLength(4);
  });

  it('short joint clamps to minCount=2', () => {
    const r = generateConfirmat(joint(120), defaults);
    expect(r.boresA).toHaveLength(2);
  });

  it('bores are evenly distributed between the setbacks (first at +endSetback, last at len-endSetback)', () => {
    const r = generateConfirmat(joint(700), defaults);
    // confirmat A is the THROUGH (face) panel — its along-joint coordinate is u.
    const us = r.boresA.map((b) => b.u).sort((a, b) => a - b);
    expect(us[0]).toBeCloseTo(60, 3);
    expect(us[us.length - 1]).toBeCloseTo(640, 3);
    // even spacing
    const gaps = us.slice(1).map((u, i) => u - us[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 3);
  });
});

describe('generateConfirmat', () => {
  it('A bores Ø7 (through) role confirmat-face; B bores Ø5 role confirmat-edge', () => {
    const r = generateConfirmat(joint(700), defaults);
    for (const b of r.boresA) {
      expect(b.diameter).toBe(7);
      expect(b.role).toBe('confirmat-face');
      expect(b.depth).toBe('throughAll');
      expect(b.connectorKind).toBe('confirmat');
    }
    for (const b of r.boresB) {
      expect(b.diameter).toBe(5);
      expect(b.role).toBe('confirmat-edge');
      expect(b.connectorKind).toBe('confirmat');
    }
  });

  it('each A bore is paired with exactly one B bore by connectorId', () => {
    const r = generateConfirmat(joint(700), defaults);
    const idsA = r.boresA.map((b) => b.connectorId);
    const idsB = r.boresB.map((b) => b.connectorId);
    expect(new Set(idsA)).toEqual(new Set(idsB));
    expect(idsA).toHaveLength(new Set(idsA).size); // unique
  });
});

describe('generateMinifix', () => {
  it('A side gets cam (Ø15) + cross (Ø8) per connector; B side gets bolt (Ø8)', () => {
    const r = generateMinifix(joint(700), defaults);
    const cams = r.boresA.filter((b) => b.role === 'minifix-cam');
    const cross = r.boresA.filter((b) => b.role === 'minifix-cross');
    const bolts = r.boresB.filter((b) => b.role === 'minifix-bolt');
    expect(cams).toHaveLength(4);
    expect(cross).toHaveLength(4);
    expect(bolts).toHaveLength(4);
    for (const c of cams) expect(c.diameter).toBe(15);
    for (const c of cross) expect(c.diameter).toBe(8);
    for (const b of bolts) expect(b.diameter).toBe(8);
  });
});

describe('generateDowel', () => {
  it('A Ø8 face ×12, B Ø8 end ×20, dowel-face / dowel-edge roles', () => {
    const r = generateDowel(joint(700), defaults);
    for (const b of r.boresA) {
      expect(b.diameter).toBe(8);
      expect(b.depth).toBe(12);
      expect(b.role).toBe('dowel-face');
    }
    for (const b of r.boresB) {
      expect(b.diameter).toBe(8);
      expect(b.depth).toBe(20);
      expect(b.role).toBe('dowel-edge');
    }
  });
});
