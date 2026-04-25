import { describe, it, expect, vi } from 'vitest';
import { WorkPlanePickController } from '../WorkPlanePickController';

describe('WorkPlanePickController', () => {
  it('starts inactive with no mode', () => {
    const ctrl = new WorkPlanePickController({ onPick: () => {} });
    expect(ctrl.isActive()).toBe(false);
    expect(ctrl.currentMode()).toBeNull();
  });

  it('activate sets isActive + mode; deactivate clears both', () => {
    const ctrl = new WorkPlanePickController({ onPick: () => {} });
    ctrl.activate('workPlane');
    expect(ctrl.isActive()).toBe(true);
    expect(ctrl.currentMode()).toBe('workPlane');
    ctrl.deactivate();
    expect(ctrl.isActive()).toBe(false);
    expect(ctrl.currentMode()).toBeNull();
  });

  it('pickFromViewport fires onPick when active and kind matches mode', () => {
    const onPick = vi.fn();
    const ctrl = new WorkPlanePickController({ onPick });
    ctrl.activate('workPlane');
    ctrl.pickFromViewport({ kind: 'workPlane', featureId: 'origin.XY' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'workPlane', featureId: 'origin.XY' });
  });

  it('pickFromViewport ignores hits whose kind does not match the active mode', () => {
    const onPick = vi.fn();
    const ctrl = new WorkPlanePickController({ onPick });
    ctrl.activate('workPlane');
    ctrl.pickFromViewport({ kind: 'face', face: { featureId: 'E1', role: 'top' } });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('pickFromViewport is a no-op when inactive', () => {
    const onPick = vi.fn();
    const ctrl = new WorkPlanePickController({ onPick });
    ctrl.pickFromViewport({ kind: 'workPlane', featureId: 'origin.XY' });
    expect(onPick).not.toHaveBeenCalled();
  });
});
