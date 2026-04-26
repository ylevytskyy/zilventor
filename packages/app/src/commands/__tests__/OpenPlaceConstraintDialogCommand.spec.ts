import { describe, it, expect } from 'vitest';
import { OpenPlaceConstraintDialogCommand } from '../OpenPlaceConstraintDialogCommand';
import { useAppStore } from '../../store/useAppStore';

describe('OpenPlaceConstraintDialogCommand', () => {
  it('opens the dialog with the requested mode', () => {
    OpenPlaceConstraintDialogCommand('mate');
    const s = useAppStore.getState();
    expect(s.placeConstraintDialogOpen).toBe(true);
    expect(s.placeConstraintMode).toBe('mate');
  });
});
