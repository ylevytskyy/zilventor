import { useAppStore } from '../store/useAppStore';

export class ToggleShowEdgeBandsCommand {
  async apply(): Promise<void> {
    const cur = useAppStore.getState().showEdgeBands;
    useAppStore.getState().setShowEdgeBands(!cur);
  }
}
