import { useAppStore } from '../store/useAppStore';

export class OpenStatisticsReportTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setStatisticsTabActive(true);
    s.setBomTabActive(false);
    s.setCutListTabActive(false);
    s.setNestingTabActive(false);
  }
}
