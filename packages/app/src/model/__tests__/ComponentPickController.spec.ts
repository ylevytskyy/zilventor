import { describe, it, expect, vi } from 'vitest';
import { ComponentPickController } from '../ComponentPickController';

describe('ComponentPickController', () => {
  it('activate / deactivate toggles isActive', () => {
    const ctrl = new ComponentPickController({ onPick: () => {} });
    expect(ctrl.isActive()).toBe(false);
    ctrl.activate();
    expect(ctrl.isActive()).toBe(true);
    ctrl.deactivate();
    expect(ctrl.isActive()).toBe(false);
  });

  it('selectFromViewport fires onPick when active', () => {
    const onPick = vi.fn();
    const ctrl = new ComponentPickController({ onPick });
    ctrl.activate();
    ctrl.selectFromViewport('C1');
    expect(onPick).toHaveBeenCalledWith('C1');
  });

  it('selectFromViewport is a no-op when inactive', () => {
    const onPick = vi.fn();
    const ctrl = new ComponentPickController({ onPick });
    ctrl.selectFromViewport('C1');
    expect(onPick).not.toHaveBeenCalled();
  });
});
