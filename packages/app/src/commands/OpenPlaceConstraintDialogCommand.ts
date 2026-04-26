import { useAppStore } from '../store/useAppStore';

export function OpenPlaceConstraintDialogCommand(mode: 'mate' | 'flush' | 'angle' | 'insert'): void {
  useAppStore.getState().openPlaceConstraintDialog(mode);
}
