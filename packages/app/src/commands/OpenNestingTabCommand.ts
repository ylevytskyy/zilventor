import { useAppStore } from '../store/useAppStore';
import type { PanelPreflightDiagnostic } from '@zilventor/shared';
import i18n from '../i18n';

export class OpenNestingTabCommand {
  constructor(private opts?: {
    diagnostics?: PanelPreflightDiagnostic[] | undefined;
    showToast?: ((message: string) => void) | undefined;
  }) {}

  async apply(): Promise<void> {
    // R1: surface each collected preflight diagnostic (name/material/geometry)
    // as a user-facing toast instead of leaving it as a console.warn only.
    for (const d of this.opts?.diagnostics ?? []) {
      this.opts?.showToast?.(i18n.t(d.reasonKey, d.params ?? {}));
    }
    const s = useAppStore.getState();
    s.setNestingTabActive(true);
    s.setBomTabActive(false);
    s.setCutListTabActive(false);
    s.setStatisticsTabActive(false);
  }
}
