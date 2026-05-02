import { describe, it, expect } from 'vitest';
import { ToggleShowEdgeBandsCommand } from '../ToggleShowEdgeBandsCommand';
import { useAppStore } from '../../store/useAppStore';

describe('ToggleShowEdgeBandsCommand', () => {
  it('flips showEdgeBands', async () => {
    useAppStore.getState().setShowEdgeBands(true);
    await new ToggleShowEdgeBandsCommand().apply();
    expect(useAppStore.getState().showEdgeBands).toBe(false);
    await new ToggleShowEdgeBandsCommand().apply();
    expect(useAppStore.getState().showEdgeBands).toBe(true);
  });
});
