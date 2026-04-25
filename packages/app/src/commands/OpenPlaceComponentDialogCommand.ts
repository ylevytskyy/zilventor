import { useAppStore } from '../store/useAppStore';

export function OpenPlaceComponentDialogCommand(): void {
  useAppStore.getState().openPlaceComponentDialog();
}
