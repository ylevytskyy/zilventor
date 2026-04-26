import { useAppStore } from '../store/useAppStore';

export function OpenEditAssemblyConstraintDialogCommand(id: string): void {
  useAppStore.getState().openEditConstraintDialog(id);
}
