import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenNestingTabCommand } from '../OpenNestingTabCommand';

describe('OpenNestingTabCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ nestingTabActive: false, bomTabActive: false, cutListTabActive: false });
  });

  it('sets nestingTabActive: true and clears bom + cutList (4-way mutex)', async () => {
    useAppStore.getState().setBomTabActive(true);
    useAppStore.getState().setCutListTabActive(true);
    await new OpenNestingTabCommand().apply();
    expect(useAppStore.getState().nestingTabActive).toBe(true);
    expect(useAppStore.getState().bomTabActive).toBe(false);
    expect(useAppStore.getState().cutListTabActive).toBe(false);
  });
});

// R1: a panel that failed the panelPreflight check must surface a user-facing
// toast when the nesting tab is opened, not just a console.warn dropped upstream.
// Mirrors ExportBoringDxfCommand / ExportPanelManufacturingDxfCommand.
describe('OpenNestingTabCommand — R1 preflight diagnostics', () => {
  it('shows a toast for each collected preflight diagnostic', async () => {
    const toasts: string[] = [];
    await new OpenNestingTabCommand({
      diagnostics: [
        { partPath: 'ghost.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'Ghost' } },
      ],
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/Ghost/);
    expect(toasts[0]).toMatch(/material/i);
  });

  it('shows no toast when there are no diagnostics', async () => {
    const toasts: string[] = [];
    await new OpenNestingTabCommand({ showToast: (msg) => toasts.push(msg) }).apply();
    expect(toasts).toHaveLength(0);
  });
});
