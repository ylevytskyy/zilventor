import type { PanelFeature, PartDocument } from '@zilventor/shared';
import { addFeature, removeFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

/**
 * Insert a `PanelFeature` as the first user feature of the active part.
 *
 * Throws:
 * - `NO_ACTIVE_PART` when no part is active.
 * - `PART_NOT_EMPTY` when the active part already contains any user feature
 *   (anything other than the seven seeded `origin.*` features).
 *
 * Apply/revert mutate `activePart` directly via `addFeature`/`removeFeature`,
 * which run `validatePanelInvariant` and reject violations.
 */
export class AddPanelFeatureCommand implements Command {
  readonly name = 'AddPanelFeature';
  constructor(private readonly panel: PanelFeature) {}

  async apply(): Promise<void> {
    const { activePart: part, kernel } = useAppStore.getState();
    if (!part) throw new Error('NO_ACTIVE_PART');
    const userFeatures = part.featureTree.filter((f) => !isOriginFeatureId(f.id));
    if (userFeatures.length > 0) throw new Error('PART_NOT_EMPTY');
    const next: PartDocument = addFeature(part, this.panel);
    // Sync the kernel BEFORE updating the store. The App.tsx reactive effect
    // fires on setActivePart and calls kernel.execute(activePart.id). If the
    // kernel were synced after, execute() would see an empty feature tree and
    // set a spurious "Feature tree produced no solid" error. By syncing first
    // the kernel already has the panel feature when execute() runs.
    if (kernel) await kernel.addFeature(part.id, this.panel);
    useAppStore.getState().setActivePart(next);
  }

  async revert(): Promise<void> {
    const { activePart: part, kernel } = useAppStore.getState();
    if (!part) return;
    const next: PartDocument = removeFeature(part, this.panel.id);
    // Same ordering principle: sync the kernel before the store update so that
    // any reactive kernel.execute() triggered by setActivePart sees the part
    // without the panel feature (consistent with the new store state).
    if (kernel) await kernel.removeFeature(part.id, this.panel.id);
    useAppStore.getState().setActivePart(next);
  }
}

function isOriginFeatureId(id: string): boolean {
  return id.startsWith('origin.');
}
