import { describe, it, expect, vi } from 'vitest';
import { AssemblyRefPickController } from '../AssemblyRefPickController';

describe('AssemblyRefPickController', () => {
  it('routes face hit to onPick callback', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('face', 'role1', cb);
    c.handleFaceHit('C1', { featureId: 'extrude.1', role: 'top' });
    expect(cb).toHaveBeenCalledWith({
      kind: 'face', role: 'role1',
      hit: { componentId: 'C1', face: { featureId: 'extrude.1', role: 'top' } },
    });
  });
  it('does not fire when inactive', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.handleFaceHit('C1', { featureId: 'a', role: 'r' });
    expect(cb).not.toHaveBeenCalled();
  });
  it('deactivate stops further dispatch', () => {
    const cb = vi.fn();
    const c = new AssemblyRefPickController();
    c.activate('face', 'r', cb);
    c.deactivate();
    c.handleFaceHit('C1', { featureId: 'a', role: 'r' });
    expect(cb).not.toHaveBeenCalled();
  });
});
