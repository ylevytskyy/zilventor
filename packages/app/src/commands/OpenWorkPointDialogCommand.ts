import { useAppStore } from '../store/useAppStore';

export function OpenWorkPointDialogCommand(): void {
  useAppStore.getState().resetWorkPointDialog();
  useAppStore.getState().toggleWorkPointDialog(true);
}
