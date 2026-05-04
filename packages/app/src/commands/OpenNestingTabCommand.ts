import { useAppStore } from '../store/useAppStore';

export class OpenNestingTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setNestingTabActive(true);
    s.setBomTabActive(false);
    s.setCutListTabActive(false);
  }
}
