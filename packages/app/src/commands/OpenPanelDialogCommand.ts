import type { PanelFeature } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore, type PanelDialogState } from '../store/useAppStore';

export type OpenPanelDialogOpts = {
  initial?: PanelFeature;
  onSubmit: (panel: PanelFeature) => void;
  onCancel?: () => void;
};

/**
 * Opens the Panel feature dialog. Mode is auto-resolved from the active
 * document:
 * - empty active part   -> 'part' mode (caller handler dispatches AddPanelFeatureCommand)
 * - active assembly     -> 'assembly' mode (caller handler dispatches CreateAndPlacePanelCommand)
 *
 * Throws `PART_NOT_EMPTY` when the active part already has a user feature
 * (panels must be the first user feature).
 *
 * Note: revert is a no-op. Dialog open/close is UI state, not undoable.
 */
export class OpenPanelDialogCommand implements Command {
  readonly name = 'OpenPanelDialog';
  constructor(private readonly opts: OpenPanelDialogOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    let mode: PanelDialogState['mode'];
    if (state.activePart) {
      const userFeatures = state.activePart.featureTree.filter((f) => !f.id.startsWith('origin.'));
      if (userFeatures.length > 0) {
        throw new Error('PART_NOT_EMPTY');
      }
      mode = 'part';
    } else if (state.activeAssembly) {
      mode = 'assembly';
    } else {
      throw new Error('NO_ACTIVE_DOCUMENT');
    }
    const slot: PanelDialogState = {
      mode,
      ...(this.opts.initial ? { initial: this.opts.initial } : {}),
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setPanelDialog(null)),
    };
    useAppStore.getState().setPanelDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: opening/closing a dialog is not undoable.
  }
}
