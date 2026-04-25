import { useAppStore } from '../store/useAppStore';

export function OpenEditComponentDialogCommand(componentId: string): void {
  useAppStore.getState().openEditComponentDialog(componentId);
}
