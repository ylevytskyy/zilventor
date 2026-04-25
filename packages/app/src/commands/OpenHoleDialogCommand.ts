import { useAppStore } from '../store/useAppStore';

/**
 * Open the Hole dialog in create mode. Resets any prior dialog state
 * (stale picks from a previous open / cancelled session) before opening.
 *
 * Bound to the H keyboard shortcut and to the Model → Modify → Hole ribbon button.
 */
export function OpenHoleDialogCommand(): void {
  useAppStore.getState().resetHoleDialog();
  useAppStore.getState().toggleHoleDialog(true);
}
