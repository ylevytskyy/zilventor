import type { Command } from './Command';
import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

/**
 * Sets a per-copy "produced" flag on the active assembly's `producedPanels` map.
 * `key` is a caller-supplied `producedPanelKey(itemNumber, copyIndex)` string (see
 * `@zilventor/shared/production/qrPayload`) — this command does not parse or compute keys.
 *
 * Undo restores the prior state EXACTLY: if the whole `producedPanels` map was absent
 * before apply(), revert() removes it again (not `{}`); if only the key was absent,
 * revert() deletes just that key; otherwise revert() restores the prior flag.
 *
 * Invoke via `bus.execute(new SetProducedCommand(...))` so it participates in undo/redo —
 * not a bare `.apply()` call (see SetUnitPriceCommand's bare-apply usage in
 * StatisticsReportTable.tsx for a known gap; don't repeat it).
 */
export class SetProducedCommand implements Command {
  readonly name = 'SetProduced';
  private hadMap = false;
  private hadKey = false;
  private prevProduced: boolean | undefined;

  constructor(private readonly opts: { key: string; produced: boolean }) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    if (s.activeDocument?.kind !== 'assembly') return;
    const doc = s.activeDocument.document;
    this.hadMap = doc.producedPanels !== undefined;
    this.hadKey = doc.producedPanels?.[this.opts.key] !== undefined;
    this.prevProduced = doc.producedPanels?.[this.opts.key];
    const nextMap = { ...(doc.producedPanels ?? {}), [this.opts.key]: this.opts.produced };
    this.writeDoc({ ...doc, producedPanels: nextMap });
  }

  async revert(): Promise<void> {
    const s = useAppStore.getState();
    if (s.activeDocument?.kind !== 'assembly') return;
    const doc = s.activeDocument.document;
    if (!this.hadMap) {
      const { producedPanels: _drop, ...rest } = doc;
      this.writeDoc(rest);
      return;
    }
    const nextMap = { ...(doc.producedPanels ?? {}) };
    if (this.hadKey) nextMap[this.opts.key] = this.prevProduced as boolean;
    else delete nextMap[this.opts.key];
    this.writeDoc({ ...doc, producedPanels: nextMap });
  }

  private writeDoc(nextDoc: AssemblyDocument): void {
    useAppStore.setState({ activeDocument: { kind: 'assembly', document: nextDoc }, activeAssembly: nextDoc });
  }
}
