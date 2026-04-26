import { describe, it, expect } from 'vitest';
import type { AssemblyConstraint, AssemblyConstraintRef, AssemblyDocument, ComponentInstance } from '../types';

describe('AssemblyConstraintRef discriminator', () => {
  it('narrows on kind=face', () => {
    const r: AssemblyConstraintRef = {
      kind: 'face',
      componentId: 'C1',
      face: { featureId: 'extrude.1', role: 'top' },
    };
    if (r.kind === 'face') expect(r.face.featureId).toBe('extrude.1');
  });
  it('narrows on kind=axis with edge source', () => {
    const r: AssemblyConstraintRef = {
      kind: 'axis',
      componentId: 'C2',
      axis: { source: 'edge', edge: { faceA: { featureId: 'a', role: 'r' }, faceB: { featureId: 'b', role: 'r' } } },
    };
    if (r.kind === 'axis' && r.axis.source === 'edge') {
      expect(r.axis.edge.faceA.featureId).toBe('a');
    }
  });
});

describe('AssemblyConstraint discriminator', () => {
  it('narrows on kind=mate', () => {
    const c: AssemblyConstraint = {
      id: 'k1', kind: 'mate',
      refA: { kind: 'face', componentId: 'C1', face: { featureId: 'a', role: 'r' } },
      refB: { kind: 'face', componentId: 'C2', face: { featureId: 'b', role: 'r' } },
      offset: { kind: 'literal', value: 0 },
      suppressed: false,
    };
    if (c.kind === 'mate') expect(c.offset.kind).toBe('literal');
  });
  it('narrows on kind=insert with circularEdge ref shape', () => {
    const c: AssemblyConstraint = {
      id: 'k2', kind: 'insert',
      refA: { componentId: 'C1', circularEdge: { faceA: { featureId: 'a', role: 'r' }, faceB: { featureId: 'b', role: 'r' } } },
      refB: { componentId: 'C2', circularEdge: { faceA: { featureId: 'c', role: 'r' }, faceB: { featureId: 'd', role: 'r' } } },
      offset: { kind: 'literal', value: 5 },
      suppressed: false,
    };
    if (c.kind === 'insert') expect(c.refA.componentId).toBe('C1');
  });
});

describe('AssemblyDocument 4b extensions', () => {
  it('carries constraints[] and groundedComponentIds[]', () => {
    const doc: AssemblyDocument = {
      id: 'A', name: 'asm', units: 'mm', parameters: {},
      components: [],
      constraints: [],
      groundedComponentIds: [],
    };
    expect(doc.constraints).toEqual([]);
    expect(doc.groundedComponentIds).toEqual([]);
  });
});

describe('ComponentInstance 4b extension', () => {
  it('accepts optional pose', () => {
    const c: ComponentInstance = {
      id: 'C1', partPath: 'p.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      pose: { translation: { x: 1, y: 2, z: 3 }, quaternion: [0, 0, 0, 1] },
    };
    expect(c.pose?.translation.x).toBe(1);
  });
  it('still works without pose (legacy 4a shape)', () => {
    const c: ComponentInstance = {
      id: 'C1', partPath: 'p.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    expect(c.pose).toBeUndefined();
  });
});
