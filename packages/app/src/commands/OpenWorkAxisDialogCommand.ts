import { useAppStore } from '../store/useAppStore';

export function OpenWorkAxisDialogCommand(): void {
  useAppStore.getState().resetWorkAxisDialog();
  useAppStore.getState().toggleWorkAxisDialog(true);
}
