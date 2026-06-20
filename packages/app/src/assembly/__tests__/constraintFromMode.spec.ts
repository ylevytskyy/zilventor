import { describe, it, expect } from 'vitest';
import { buildAssemblyConstraint } from '../constraintFromMode';
import type { AssemblyConstraintRef, FaceName, EdgeName, ComponentPath, ParamOrLiteral } from '@zilventor/shared';

const faceTop: FaceName = { featureId: 'f1', role: 'Top' };
const faceBottom: FaceName = { featureId: 'f2', role: 'Bottom' };
const edgeAB: EdgeName = { faceA: faceTop, faceB: faceBottom };

const refA: AssemblyConstraintRef = { kind: 'face', componentPath: ['parts/box.zipt'] as ComponentPath, face: faceTop };
const refB: AssemblyConstraintRef = { kind: 'face', componentPath: ['parts/lid.zipt'] as ComponentPath, face: faceBottom };
const zeroLiteral: ParamOrLiteral = { kind: 'literal', value: 0 };
const offsetLiteral: ParamOrLiteral = { kind: 'literal', value: 5 };
const angleLiteral: ParamOrLiteral = { kind: 'literal', value: 90 };

describe('buildAssemblyConstraint', () => {
  it('coincident maps to kind=mate with offset literal 0 (ignoring passed offset)', () => {
    const result = buildAssemblyConstraint({
      id: 'K001',
      mode: 'coincident',
      refA,
      refB,
      offset: offsetLiteral, // should be ignored — coincident always locks to 0
      angle: angleLiteral,
    });
    expect(result.kind).toBe('mate');
    expect(result).toMatchObject({
      id: 'K001',
      kind: 'mate',
      refA,
      refB,
      offset: { kind: 'literal', value: 0 },
      suppressed: false,
    });
  });

  it('mate uses the passed offset (proves coincident is not special-casing everything as 0)', () => {
    const result = buildAssemblyConstraint({
      id: 'K002',
      mode: 'mate',
      refA,
      refB,
      offset: offsetLiteral,
      angle: angleLiteral,
    });
    expect(result.kind).toBe('mate');
    expect(result).toMatchObject({
      id: 'K002',
      kind: 'mate',
      refA,
      refB,
      offset: offsetLiteral,
      suppressed: false,
    });
  });

  it('flush produces kind=flush with offset', () => {
    const result = buildAssemblyConstraint({
      id: 'K003',
      mode: 'flush',
      refA,
      refB,
      offset: zeroLiteral,
      angle: angleLiteral,
    });
    expect(result.kind).toBe('flush');
    expect(result).toMatchObject({
      id: 'K003',
      kind: 'flush',
      offset: zeroLiteral,
      suppressed: false,
    });
  });

  it('angle produces kind=angle with angle field (not offset)', () => {
    const result = buildAssemblyConstraint({
      id: 'K004',
      mode: 'angle',
      refA,
      refB,
      offset: zeroLiteral,
      angle: angleLiteral,
    });
    expect(result.kind).toBe('angle');
    expect(result).toMatchObject({
      id: 'K004',
      kind: 'angle',
      angle: angleLiteral,
      suppressed: false,
    });
    // angle constraints must NOT have an offset field
    expect('offset' in result).toBe(false);
  });

  it('insert produces kind=insert with offset', () => {
    const circRefA = { componentPath: ['parts/shaft.zipt'] as ComponentPath, circularEdge: edgeAB };
    const circRefB = { componentPath: ['parts/hole.zipt'] as ComponentPath, circularEdge: edgeAB };
    const result = buildAssemblyConstraint({
      id: 'K005',
      mode: 'insert',
      refA: circRefA as unknown as AssemblyConstraintRef,
      refB: circRefB as unknown as AssemblyConstraintRef,
      offset: zeroLiteral,
      angle: angleLiteral,
    });
    expect(result.kind).toBe('insert');
    expect(result).toMatchObject({
      id: 'K005',
      kind: 'insert',
      offset: zeroLiteral,
      suppressed: false,
    });
  });
});
