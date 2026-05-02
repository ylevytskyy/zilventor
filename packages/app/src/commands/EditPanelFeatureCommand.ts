import type { PanelFeature, PartDocument } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

/**
 * Replace an existing `PanelFeature` in the active part with a new value
 * (same `id`). Stashes the prior feature so revert restores it.
 *
 * Throws:
 * - `NO_ACTIVE_PART` when no part is active.
 * - `PANEL_NOT_FOUND` when no feature with matching id+kind=panel exists.
 */
export class EditPanelFeatureCommand implements Command {
  readonly name = 'EditPanelFeature';
  private prior: PanelFeature | null = null;
  constructor(private readonly next: PanelFeature) {}

  async apply(): Promise<void> {
    const part = useAppStore.getState().activePart;
    if (!part) throw new Error('NO_ACTIVE_PART');
    const existing = part.featureTree.find(
      (f): f is PanelFeature => f.kind === 'panel' && f.id === this.next.id,
    );
    if (!existing) throw new Error(`PANEL_NOT_FOUND: ${this.next.id}`);
    this.prior = existing;
    const tree = part.featureTree.map((f) => (f.id === this.next.id && f.kind === 'panel' ? this.next : f));
    const updated: PartDocument = { ...part, featureTree: tree };
    useAppStore.getState().setActivePart(updated);
  }

  async revert(): Promise<void> {
    const prior = this.prior;
    if (!prior) return;
    const part = useAppStore.getState().activePart;
    if (!part) return;
    const tree = part.featureTree.map((f) => (f.id === prior.id && f.kind === 'panel' ? prior : f));
    const updated: PartDocument = { ...part, featureTree: tree };
    useAppStore.getState().setActivePart(updated);
    this.prior = null;
  }
}
