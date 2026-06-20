import { describe, it, expect } from 'vitest';
import { paramRefValuesOf } from '../constraintParamRefs';
import type { AssemblyConstraint, AssemblyConstraintRef, FaceName, ComponentPath, ParamOrLiteral } from '@zilventor/shared';

const faceTop: FaceName = { featureId: 'f1', role: 'Top' };
const faceBottom: FaceName = { featureId: 'f2', role: 'Bottom' };
const refA: AssemblyConstraintRef = { kind: 'face', componentPath: ['parts/box.zipt'] as ComponentPath, face: faceTop };
const refB: AssemblyConstraintRef = { kind: 'face', componentPath: ['parts/lid.zipt'] as ComponentPath, face: faceBottom };
const axisRefA: AssemblyConstraintRef = {
  kind: 'axis',
  componentPath: ['parts/cyl.zipt'] as ComponentPath,
  axis: { source: 'cylindricalFace', face: faceTop },
};
const axisRefB: AssemblyConstraintRef = {
  kind: 'axis',
  componentPath: ['parts/plane.zipt'] as ComponentPath,
  axis: { source: 'cylindricalFace', face: faceBottom },
};

const paramRef: ParamOrLiteral = { kind: 'param', paramName: 'myRadius' };
const r2Param: ParamOrLiteral = { kind: 'param', paramName: 'r2' };
const literal5: ParamOrLiteral = { kind: 'literal', value: 5 };

describe('paramRefValuesOf', () => {
  it('mate: returns [offset]', () => {
    const c: AssemblyConstraint = {
      id: 'K1', kind: 'mate', refA, refB, offset: literal5, suppressed: false,
    };
    const refs = paramRefValuesOf(c);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toBe(c.offset);
  });

  it('flush: returns [offset]', () => {
    const c: AssemblyConstraint = {
      id: 'K2', kind: 'flush', refA, refB, offset: literal5, suppressed: false,
    };
    const refs = paramRefValuesOf(c);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toBe(c.offset);
  });

  it('angle: returns [angle] — NOT offset (angle constraints have no offset field)', () => {
    const c: AssemblyConstraint = {
      id: 'K3', kind: 'angle', refA, refB,
      angle: { kind: 'literal', value: 90 }, suppressed: false,
    };
    const refs = paramRefValuesOf(c);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toBe(c.angle);
    // Non-tautological: must be the angle field, not some fallback
    expect((refs[0] as { kind: string; value?: number }).value).toBe(90);
  });

  // ── Tangent cyl↔plane: radius defined, r1/r2 absent ─────────────────────
  it('tangent cyl↔plane: returns [radius] only', () => {
    const c: AssemblyConstraint = {
      id: 'K4', kind: 'tangent', refA, refB: axisRefA,
      radius: paramRef,
      suppressed: false,
    };
    const refs = paramRefValuesOf(c);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toBe(paramRef);
    // Non-tautological: it must be a param ref with the right name
    expect((refs[0] as { kind: string; paramName?: string }).paramName).toBe('myRadius');
  });

  // ── Tangent cyl↔cyl: r1 + r2 defined, radius absent ─────────────────────
  it('tangent cyl↔cyl: returns [r1, r2] only', () => {
    const c: AssemblyConstraint = {
      id: 'K5', kind: 'tangent', refA: axisRefA, refB: axisRefB,
      r1: paramRef,
      r2: r2Param,
      suppressed: false,
    };
    const refs = paramRefValuesOf(c);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toBe(paramRef);
    expect(refs[1]).toBe(r2Param);
  });

  // ── Tangent with NO radius/r1/r2 (degenerate, all optional) ──────────────
  it('tangent with no radius/r1/r2 defined: returns []', () => {
    const c: AssemblyConstraint = {
      id: 'K6', kind: 'tangent', refA, refB: axisRefA,
      suppressed: false,
    };
    const refs = paramRefValuesOf(c);
    expect(refs).toHaveLength(0);
  });

  // ── Anti-tautology: angle NOT treated as offset ───────────────────────────
  it('angle constraint: paramRefValuesOf does NOT include offset (angle has no offset)', () => {
    const c: AssemblyConstraint = {
      id: 'K7', kind: 'angle', refA, refB,
      angle: paramRef, suppressed: false,
    };
    // If we mistakenly returned `(c as any).offset` (the old code path), it would
    // return `undefined`. The array must contain exactly 1 defined value.
    const refs = paramRefValuesOf(c);
    expect(refs.every((r) => r !== undefined)).toBe(true);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toStrictEqual({ kind: 'param', paramName: 'myRadius' });
  });

  // ── The core failure the fix addresses: tangent would have returned []  ───
  // Under the OLD code: `k.kind === 'angle' ? k.angle : k.offset`
  // tangent has no `offset` → returns undefined → param-ref never detected.
  // This test asserts the NEW behaviour: a tangent with a param-ref radius IS detected.
  it('tangent with param-ref radius: is detected as having a param ref', () => {
    const c: AssemblyConstraint = {
      id: 'K8', kind: 'tangent', refA, refB: axisRefA,
      radius: { kind: 'param', paramName: 'cyl_r' },
      suppressed: false,
    };
    const refs = paramRefValuesOf(c);
    const hasParam = refs.some((r) => r.kind === 'param');
    expect(hasParam).toBe(true);
  });
});
