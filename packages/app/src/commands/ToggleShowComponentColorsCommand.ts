import { useAppStore } from '../store/useAppStore';

export class ToggleShowComponentColorsCommand {
  async apply(): Promise<void> {
    const cur = useAppStore.getState().showComponentColors;
    useAppStore.getState().setShowComponentColors(!cur);
  }
}
