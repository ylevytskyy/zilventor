import { describe, it, expect, vi } from 'vitest';
import { AssemblyRefPickController } from '../AssemblyRefPickController';

describe('AssemblyRefPickController', () => {
  it('routes face hit to onPick callback (T30: carries componentPath)', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('face', 'role1', cb);
    c.handleFaceHit(['C1'], { featureId: 'extrude.1', role: 'top' });
    expect(cb).toHaveBeenCalledWith({
      kind: 'face', role: 'role1',
      hit: { componentPath: ['C1'], face: { featureId: 'extrude.1', role: 'top' } },
    });
  });
  it('preserves multi-segment componentPath through dispatch', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('face', 'role1', cb);
    c.handleFaceHit(['drawer', 'screw'], { featureId: 'f.1', role: 'r' });
    expect(cb).toHaveBeenCalledWith({
      kind: 'face', role: 'role1',
      hit: { componentPath: ['drawer', 'screw'], face: { featureId: 'f.1', role: 'r' } },
    });
  });
  it('does not fire when inactive', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.handleFaceHit(['C1'], { featureId: 'a', role: 'r' });
    expect(cb).not.toHaveBeenCalled();
  });
  it('deactivate stops further dispatch', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('face', 'r', cb);
    c.deactivate();
    c.handleFaceHit(['C1'], { featureId: 'a', role: 'r' });
    expect(cb).not.toHaveBeenCalled();
  });
  it('routes edge hit with componentPath', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('edge', 'A', cb);
    const edge = { faceA: { featureId: 'f.1', role: 'r1' }, faceB: { featureId: 'f.2', role: 'r2' } };
    c.handleEdgeHit(['drawer', 'rail'], edge, false);
    expect(cb).toHaveBeenCalledWith({
      kind: 'edge', role: 'A',
      hit: { componentPath: ['drawer', 'rail'], edge },
    });
  });
  it('routes axis hit (cylindricalFace source) with componentPath', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('axis', 'B', cb);
    c.handleCylindricalFaceHit(['x'], { featureId: 'f.1', role: 'r' });
    expect(cb).toHaveBeenCalledWith({
      kind: 'axis', role: 'B',
      hit: { componentPath: ['x'], source: 'cylindricalFace', face: { featureId: 'f.1', role: 'r' } },
    });
  });
  it('routes vertex hit with componentPath', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('point', 'A', cb);
    const edge = { faceA: { featureId: 'f.1', role: 'r1' }, faceB: { featureId: 'f.2', role: 'r2' } };
    c.handleVertexHit(['x'], edge, 'start');
    expect(cb).toHaveBeenCalledWith({
      kind: 'point', role: 'A',
      hit: { componentPath: ['x'], vertex: { edge, end: 'start' } },
    });
  });
});
