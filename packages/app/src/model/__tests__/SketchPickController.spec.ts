import { describe, it, expect, vi } from 'vitest';
import { SketchPickController } from '../SketchPickController';

describe('SketchPickController', () => {
  it('activate / deactivate toggles isActive', () => {
    const ctrl = new SketchPickController({ onPick: () => {} });
    expect(ctrl.isActive()).toBe(false);
    ctrl.activate();
    expect(ctrl.isActive()).toBe(true);
    ctrl.deactivate();
    expect(ctrl.isActive()).toBe(false);
  });

  it('selectFromBrowser fires onPick when active', () => {
    const onPick = vi.fn();
    const ctrl = new SketchPickController({ onPick });
    ctrl.activate();
    ctrl.selectFromBrowser('S1');
    expect(onPick).toHaveBeenCalledWith('S1');
  });

  it('selectFromBrowser is a no-op when inactive', () => {
    const onPick = vi.fn();
    const ctrl = new SketchPickController({ onPick });
    ctrl.selectFromBrowser('S1');
    expect(onPick).not.toHaveBeenCalled();
  });
});
