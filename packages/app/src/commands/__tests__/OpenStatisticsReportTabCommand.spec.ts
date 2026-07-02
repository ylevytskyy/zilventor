import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenStatisticsReportTabCommand } from '../OpenStatisticsReportTabCommand';
import { OpenCutListTabCommand } from '../OpenCutListTabCommand';
import { OpenBomTabCommand } from '../OpenBomTabCommand';
import { OpenNestingTabCommand } from '../OpenNestingTabCommand';

describe('OpenStatisticsReportTabCommand', () => {
  beforeEach(() => {
    useAppStore.setState({
      bomTabActive: false, cutListTabActive: false, nestingTabActive: false, statisticsTabActive: false,
    });
  });

  it('sets statisticsTabActive: true and clears the other three tabs', async () => {
    useAppStore.getState().setBomTabActive(true);
    await new OpenStatisticsReportTabCommand().apply();
    expect(useAppStore.getState().statisticsTabActive).toBe(true);
    expect(useAppStore.getState().bomTabActive).toBe(false);
    expect(useAppStore.getState().cutListTabActive).toBe(false);
    expect(useAppStore.getState().nestingTabActive).toBe(false);
  });

  it('opening Cut List / BOM / Nesting after Statistics clears statisticsTabActive (5-way mutex)', async () => {
    await new OpenStatisticsReportTabCommand().apply();
    await new OpenCutListTabCommand().apply();
    expect(useAppStore.getState().statisticsTabActive).toBe(false);

    await new OpenStatisticsReportTabCommand().apply();
    await new OpenBomTabCommand().apply();
    expect(useAppStore.getState().statisticsTabActive).toBe(false);

    await new OpenStatisticsReportTabCommand().apply();
    await new OpenNestingTabCommand().apply();
    expect(useAppStore.getState().statisticsTabActive).toBe(false);
  });
});
