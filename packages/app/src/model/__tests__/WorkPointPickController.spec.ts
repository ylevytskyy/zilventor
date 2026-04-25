import { describe, it, expect, vi } from 'vitest';
import { WorkPointPickController } from '../WorkPointPickController';

describe('WorkPointPickController', () => {
  it('starts inactive with no mode', () => {
    const ctrl = new WorkPointPickController({ onPick: () => {} });
    expect(ctrl.isActive()).toBe(false);
    expect(ctrl.currentMode()).toBeNull();
  });

  it('activate sets isActive + mode; deactivate clears both', () => {
    const ctrl = new WorkPointPickController({ onPick: () => {} });
    ctrl.activate('vertex');
    expect(ctrl.isActive()).toBe(true);
    expect(ctrl.currentMode()).toBe('vertex');
    ctrl.deactivate();
    expect(ctrl.isActive()).toBe(false);
  });

  it('pickFromViewport forwards a workPoint hit when active in workPoint mode', () => {
    const onPick = vi.fn();
    const ctrl = new WorkPointPickController({ onPick });
    ctrl.activate('workPoint');
    ctrl.pickFromViewport({ kind: 'workPoint', featureId: 'origin.O' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'workPoint', featureId: 'origin.O' });
  });

  it('pickFromViewport ignores mode-mismatch hits', () => {
    const onPick = vi.fn();
    const ctrl = new WorkPointPickController({ onPick });
    ctrl.activate('workPoint');
    ctrl.pickFromViewport({
      kind: 'vertex',
      edge: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side' } },
      end: 'start',
    });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('pickFromViewport is a no-op when inactive', () => {
    const onPick = vi.fn();
    const ctrl = new WorkPointPickController({ onPick });
    ctrl.pickFromViewport({ kind: 'workPoint', featureId: 'origin.O' });
    expect(onPick).not.toHaveBeenCalled();
  });
});
