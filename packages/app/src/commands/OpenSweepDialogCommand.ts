import { useAppStore } from '../store/useAppStore';

export function OpenSweepDialogCommand(): void {
  useAppStore.getState().resetSweepDialog();
  useAppStore.getState().toggleSweepDialog(true);
}
