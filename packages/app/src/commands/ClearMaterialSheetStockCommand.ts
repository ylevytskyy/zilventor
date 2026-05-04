import type { Command } from './Command';
import type { MaterialEntry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

function activeMaterials(): readonly MaterialEntry[] {
  const s = useAppStore.getState();
  if (s.activeAssembly) return s.activeAssembly.materials;
  if (s.activePart) return s.activePart.materials;
  return [];
}

export class ClearMaterialSheetStockCommand implements Command {
  readonly name = 'ClearMaterialSheetStock';
  private prevEntry: MaterialEntry | null = null;
  constructor(private id: string) {}

  async apply(): Promise<void> {
    const existing = activeMaterials().find((m) => m.id === this.id);
    if (!existing) throw new Error(`MATERIAL_NOT_FOUND: ${this.id}`);
    this.prevEntry = existing;
    useAppStore.getState().clearMaterialSheetStock(this.id);
  }

  async revert(): Promise<void> {
    if (this.prevEntry === null) return;
    const { sheetLengthMm, sheetWidthMm } = this.prevEntry;
    if (sheetLengthMm !== undefined || sheetWidthMm !== undefined) {
      useAppStore.getState().updateMaterial(this.id, {
        ...(sheetLengthMm !== undefined ? { sheetLengthMm } : {}),
        ...(sheetWidthMm !== undefined ? { sheetWidthMm } : {}),
      });
    }
    this.prevEntry = null;
  }
}
