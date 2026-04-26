import { describe, it, expect } from 'vitest';
import { ToggleShowComponentColorsCommand } from '../ToggleShowComponentColorsCommand';
import { useAppStore } from '../../store/useAppStore';

describe('ToggleShowComponentColorsCommand', () => {
  it('flips showComponentColors', async () => {
    useAppStore.setState({ showComponentColors: false } as any);
    await new ToggleShowComponentColorsCommand().apply();
    expect(useAppStore.getState().showComponentColors).toBe(true);
    await new ToggleShowComponentColorsCommand().apply();
    expect(useAppStore.getState().showComponentColors).toBe(false);
  });
});
