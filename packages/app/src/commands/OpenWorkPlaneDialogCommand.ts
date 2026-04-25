import { useAppStore } from '../store/useAppStore';

export function OpenWorkPlaneDialogCommand(): void {
  useAppStore.getState().resetWorkPlaneDialog();
  useAppStore.getState().toggleWorkPlaneDialog(true);
}
