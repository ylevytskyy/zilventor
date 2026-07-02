import { useAppStore } from '../store/useAppStore';

export class OpenCutListTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setCutListTabActive(true);
    s.setBomTabActive(false);
    s.setNestingTabActive(false);
    s.setStatisticsTabActive(false);
  }
}
