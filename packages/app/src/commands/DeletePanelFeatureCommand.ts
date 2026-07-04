import type { PartDocument } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

/**
 * Remove a `PanelFeature` (by id) from the active part's feature tree.
 * Snapshots the whole prior document so revert restores it exactly.
 *
 * Throws:
 * - `NO_ACTIVE_PART` when no part is active.
 * - `PANEL_NOT_FOUND` when no feature with matching id+kind=panel exists.
 */
export class DeletePanelFeatureCommand implements Command {
  readonly name = 'DeletePanelFeature';
  private prior: PartDocument | null = null;
  constructor(private readonly panelId: string) {}

  async apply(): Promise<void> {
    const part = useAppStore.getState().activePart;
    if (!part) throw new Error('NO_ACTIVE_PART');
    const existing = part.featureTree.find((f) => f.kind === 'panel' && f.id === this.panelId);
    if (!existing) throw new Error(`PANEL_NOT_FOUND: ${this.panelId}`);
    this.prior = part;
    const tree = part.featureTree.filter((f) => f.id !== this.panelId);
    useAppStore.getState().setActivePart({ ...part, featureTree: tree });
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().setActivePart(this.prior);
    this.prior = null;
  }
}
