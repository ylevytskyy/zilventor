import { useAppStore } from '../store/useAppStore';

export class OpenBomTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setBomTabActive(true);
    s.setCutListTabActive(false);
    s.setNestingTabActive(false);
  }
}
