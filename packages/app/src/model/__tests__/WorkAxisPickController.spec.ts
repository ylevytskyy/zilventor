import { describe, it, expect, vi } from 'vitest';
import { WorkAxisPickController } from '../WorkAxisPickController';

describe('WorkAxisPickController', () => {
  it('starts inactive with no mode', () => {
    const ctrl = new WorkAxisPickController({ onPick: () => {} });
    expect(ctrl.isActive()).toBe(false);
    expect(ctrl.currentMode()).toBeNull();
  });

  it('activate sets isActive + mode; deactivate clears both', () => {
    const ctrl = new WorkAxisPickController({ onPick: () => {} });
    ctrl.activate('cylindricalFace');
    expect(ctrl.isActive()).toBe(true);
    expect(ctrl.currentMode()).toBe('cylindricalFace');
    ctrl.deactivate();
    expect(ctrl.isActive()).toBe(false);
  });

  it('pickFromViewport forwards a workAxis hit when active in workAxis mode', () => {
    const onPick = vi.fn();
    const ctrl = new WorkAxisPickController({ onPick });
    ctrl.activate('workAxis');
    ctrl.pickFromViewport({ kind: 'workAxis', featureId: 'origin.X' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'workAxis', featureId: 'origin.X' });
  });

  it('pickFromViewport ignores mode-mismatch hits', () => {
    const onPick = vi.fn();
    const ctrl = new WorkAxisPickController({ onPick });
    ctrl.activate('cylindricalFace');
    ctrl.pickFromViewport({ kind: 'workAxis', featureId: 'origin.X' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('pickFromViewport is a no-op when inactive', () => {
    const onPick = vi.fn();
    const ctrl = new WorkAxisPickController({ onPick });
    ctrl.pickFromViewport({ kind: 'workAxis', featureId: 'origin.X' });
    expect(onPick).not.toHaveBeenCalled();
  });
});
