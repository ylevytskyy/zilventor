import type { Command } from './Command';
import type { MaterialEntry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type EditMaterialPatch = Partial<Omit<MaterialEntry, 'id'>> & {
  /** When true, the reducer removes sheetLengthMm + sheetWidthMm from the entry (atomic with any other patch fields). */
  clearSheetStock?: true;
  /** When true, the reducer removes hatchAngleDeg + hatchSpacingMm from the entry (atomic with any other patch fields). */
  clearHatch?: true;
};

function activeMaterials(): readonly MaterialEntry[] {
  const s = useAppStore.getState();
  if (s.activeAssembly) return s.activeAssembly.materials;
  if (s.activePart) return s.activePart.materials;
  return [];
}

export class EditMaterialCommand implements Command {
  readonly name = 'EditMaterial';
  private prev: MaterialEntry | null = null;
  constructor(private id: string, private patch: EditMaterialPatch) {}

  async apply(): Promise<void> {
    const existing = activeMaterials().find((m) => m.id === this.id);
    if (!existing) throw new Error(`MATERIAL_NOT_FOUND: ${this.id}`);
    if (this.patch.name !== undefined) {
      const lower = this.patch.name.trim().toLowerCase();
      const dup = activeMaterials().some(
        (m) => m.id !== this.id && m.name.trim().toLowerCase() === lower,
      );
      if (dup) throw new Error(`DUPLICATE_NAME: ${this.patch.name}`);
    }
    this.prev = existing;
    useAppStore.getState().updateMaterial(this.id, this.patch);
  }

  async revert(): Promise<void> {
    if (this.prev) {
      const { id: _id, ...rest } = this.prev;
      // The spread-merge reducer can't REMOVE keys absent from `rest`. If prev
      // is missing either side of the hatch pair, emit clearHatch so the merge
      // doesn't leak newly-added hatch keys from the post-apply state. The
      // both-or-neither invariant means a partial pair shouldn't occur in normal
      // operation, but the defensive `||` keeps us safe under legacy data too.
      const prevLacksHatchPair = this.prev.hatchAngleDeg === undefined
        || this.prev.hatchSpacingMm === undefined;
      const patch = prevLacksHatchPair
        ? { ...rest, clearHatch: true as const }
        : rest;
      useAppStore.getState().updateMaterial(this.id, patch);
      this.prev = null;
    }
  }
}
