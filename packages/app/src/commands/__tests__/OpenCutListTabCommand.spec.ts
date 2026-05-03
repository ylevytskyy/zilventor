import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenCutListTabCommand } from '../OpenCutListTabCommand';
import { OpenBomTabCommand } from '../OpenBomTabCommand';

describe('OpenCutListTabCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ bomTabActive: false, cutListTabActive: false });
  });

  it('sets cutListTabActive: true and bomTabActive: false', async () => {
    useAppStore.getState().setBomTabActive(true);
    await new OpenCutListTabCommand().apply();
    expect(useAppStore.getState().cutListTabActive).toBe(true);
    expect(useAppStore.getState().bomTabActive).toBe(false);
  });
});

describe('OpenBomTabCommand mutual exclusion', () => {
  beforeEach(() => {
    useAppStore.setState({ bomTabActive: false, cutListTabActive: false });
  });

  it('clears cutListTabActive when opening BOM', async () => {
    useAppStore.getState().setCutListTabActive(true);
    await new OpenBomTabCommand().apply();
    expect(useAppStore.getState().bomTabActive).toBe(true);
    expect(useAppStore.getState().cutListTabActive).toBe(false);
  });
});
