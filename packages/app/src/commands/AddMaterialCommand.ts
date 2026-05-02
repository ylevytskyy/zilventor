import type { Command } from './Command';
import type { MaterialEntry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddMaterialOpts = {
  name: string;
  defaultThickness: number;
  color: string;
};

function activeMaterials(): readonly MaterialEntry[] {
  const s = useAppStore.getState();
  if (s.activeAssembly) return s.activeAssembly.materials;
  if (s.activePart) return s.activePart.materials;
  return [];
}

function nextMaterialId(): string {
  return `mat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AddMaterialCommand implements Command {
  readonly name = 'AddMaterial';
  private addedId: string | null = null;
  constructor(private opts: AddMaterialOpts) {}

  async apply(): Promise<void> {
    const existing = activeMaterials();
    const lower = this.opts.name.trim().toLowerCase();
    if (existing.some((m) => m.name.trim().toLowerCase() === lower)) {
      throw new Error(`DUPLICATE_NAME: ${this.opts.name}`);
    }
    const entry: MaterialEntry = {
      id: nextMaterialId(),
      name: this.opts.name,
      defaultThickness: this.opts.defaultThickness,
      color: this.opts.color,
    };
    useAppStore.getState().addMaterial(entry);
    this.addedId = entry.id;
  }

  async revert(): Promise<void> {
    if (this.addedId) {
      useAppStore.getState().removeMaterial(this.addedId);
      this.addedId = null;
    }
  }
}
