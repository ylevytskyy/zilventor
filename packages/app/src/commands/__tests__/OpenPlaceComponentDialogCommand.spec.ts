import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenPlaceComponentDialogCommand } from '../OpenPlaceComponentDialogCommand';

describe('OpenPlaceComponentDialogCommand', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlaceComponentDialog();
  });

  it('opens the dialog', () => {
    OpenPlaceComponentDialogCommand();
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(true);
  });
});
