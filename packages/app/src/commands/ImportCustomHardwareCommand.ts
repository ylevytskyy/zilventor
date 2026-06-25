import type { Command } from './Command';
import type { HardwareCatalogEntry } from '@zilventor/shared/src/hardware/resolveCatalog';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export interface ImportCustomHardwareOpts {
  entries: HardwareCatalogEntry[];
  store?: typeof useAppStore;
}

export class ImportCustomHardwareCommand implements Command {
  readonly name = 'ImportCustomHardware';
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: ImportCustomHardwareOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    this.store.getState().addCustomHardware(this.opts.entries);
  }

  async revert(): Promise<void> {
    const ids = new Set(this.opts.entries.map((e) => e.id));
    this.store.setState((s) => {
      if (s.activeAssembly) {
        const next: AssemblyDocument = {
          ...s.activeAssembly,
          customHardware: (s.activeAssembly.customHardware ?? []).filter((e) => !ids.has(e.id)),
        };
        return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
      }
      if (s.activePart) {
        const next: PartDocument = {
          ...s.activePart,
          customHardware: (s.activePart.customHardware ?? []).filter((e) => !ids.has(e.id)),
        };
        return { activeDocument: { kind: 'part', document: next }, activePart: next };
      }
      return s;
    });
  }
}
