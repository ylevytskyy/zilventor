import { useAppStore } from '../store/useAppStore';

export class OpenProductionTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setProductionTabActive(true);
    s.setBomTabActive(false);
    s.setCutListTabActive(false);
    s.setNestingTabActive(false);
    s.setStatisticsTabActive(false);
  }
}
