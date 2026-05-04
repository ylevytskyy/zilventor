import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenNestingTabCommand } from '../OpenNestingTabCommand';

describe('OpenNestingTabCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ nestingTabActive: false, bomTabActive: false, cutListTabActive: false });
  });

  it('sets nestingTabActive: true and clears bom + cutList (4-way mutex)', async () => {
    useAppStore.getState().setBomTabActive(true);
    useAppStore.getState().setCutListTabActive(true);
    await new OpenNestingTabCommand().apply();
    expect(useAppStore.getState().nestingTabActive).toBe(true);
    expect(useAppStore.getState().bomTabActive).toBe(false);
    expect(useAppStore.getState().cutListTabActive).toBe(false);
  });
});
