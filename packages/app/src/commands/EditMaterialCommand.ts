import type { Command } from './Command';
import type { MaterialEntry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type EditMaterialPatch = Partial<Omit<MaterialEntry, 'id'>>;

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
      useAppStore.getState().updateMaterial(this.id, rest);
      this.prev = null;
    }
  }
}
