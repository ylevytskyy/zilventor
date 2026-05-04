import { describe, it, expect } from 'vitest';
import { OpenBomTabCommand } from '../OpenBomTabCommand';
import { useAppStore } from '../../store/useAppStore';

describe('OpenBomTabCommand', () => {
  it('flips bomTabActive true', async () => {
    useAppStore.setState({ bomTabActive: false } as any);
    await new OpenBomTabCommand().apply();
    expect(useAppStore.getState().bomTabActive).toBe(true);
  });

  it('clears nestingTabActive (4-way mutex)', async () => {
    useAppStore.getState().setNestingTabActive(true);
    await new OpenBomTabCommand().apply();
    expect(useAppStore.getState().nestingTabActive).toBe(false);
  });
});
