import type { Command } from './Command';
import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

/**
 * Sets a per-document unit price override (P4 price-key convention:
 * `material:<id>` | `hardware:<skuId>` | `connector:<kind>` | `edgeband:<materialId>` |
 * `linear:<materialId>`) on the active assembly's `unitPrices` map.
 *
 * Undo restores the prior state EXACTLY: if the whole `unitPrices` map was absent
 * before apply(), revert() removes it again (not `{}`); if only the key was absent,
 * revert() deletes just that key; otherwise revert() restores the prior price.
 */
export class SetUnitPriceCommand implements Command {
  readonly name = 'SetUnitPrice';
  private hadMap = false;
  private hadKey = false;
  private prevPrice: number | undefined;

  constructor(private readonly opts: { key: string; price: number }) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    if (s.activeDocument?.kind !== 'assembly') return;
    const doc = s.activeDocument.document;
    this.hadMap = doc.unitPrices !== undefined;
    this.hadKey = doc.unitPrices?.[this.opts.key] !== undefined;
    this.prevPrice = doc.unitPrices?.[this.opts.key];
    const nextMap = { ...(doc.unitPrices ?? {}), [this.opts.key]: this.opts.price };
    this.writeDoc({ ...doc, unitPrices: nextMap });
  }

  async revert(): Promise<void> {
    const s = useAppStore.getState();
    if (s.activeDocument?.kind !== 'assembly') return;
    const doc = s.activeDocument.document;
    if (!this.hadMap) {
      const { unitPrices: _drop, ...rest } = doc;
      this.writeDoc(rest);
      return;
    }
    const nextMap = { ...(doc.unitPrices ?? {}) };
    if (this.hadKey) nextMap[this.opts.key] = this.prevPrice as number;
    else delete nextMap[this.opts.key];
    this.writeDoc({ ...doc, unitPrices: nextMap });
  }

  private writeDoc(nextDoc: AssemblyDocument): void {
    useAppStore.setState({ activeDocument: { kind: 'assembly', document: nextDoc }, activeAssembly: nextDoc });
  }
}
