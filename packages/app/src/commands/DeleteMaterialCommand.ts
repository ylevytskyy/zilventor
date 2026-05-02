import type { Command } from './Command';
import type { MaterialEntry, PartDocument, PanelFeature } from '@zilventor/shared';
import { isPanelFeature } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

function activeMaterials(): readonly MaterialEntry[] {
  const s = useAppStore.getState();
  if (s.activeAssembly) return s.activeAssembly.materials;
  if (s.activePart) return s.activePart.materials;
  return [];
}

function collectPanels(part: PartDocument): PanelFeature[] {
  return part.featureTree.filter((f): f is PanelFeature => isPanelFeature(f));
}

function panelReferences(panel: PanelFeature, materialId: string): boolean {
  if (panel.materialId === materialId) return true;
  for (const key of ['front', 'back', 'left', 'right'] as const) {
    const band = panel.edgeBands[key];
    if (band && band.materialId === materialId) return true;
  }
  return false;
}

function findReferencingPanelIds(materialId: string): string[] {
  const s = useAppStore.getState();
  const refs: string[] = [];
  if (s.activePart) {
    for (const p of collectPanels(s.activePart)) {
      if (panelReferences(p, materialId)) refs.push(p.id);
    }
  }
  // Note: an active assembly's components reference part files on disk; the
  // panels live inside those parts, not on the assembly document. The plan
  // calls for walking "the active document" — we cover the active part case;
  // assembly-wide cross-part walking would require kernel/OPFS access and is
  // intentionally out of scope for this command (see project notes).
  return refs;
}

export class DeleteMaterialCommand implements Command {
  readonly name = 'DeleteMaterial';
  private prev: MaterialEntry | null = null;
  constructor(private id: string) {}

  async apply(): Promise<void> {
    const refs = findReferencingPanelIds(this.id);
    if (refs.length > 0) {
      throw new Error(`MATERIAL_IN_USE: referenced by panel(s) ${refs.join(', ')}`);
    }
    const existing = activeMaterials().find((m) => m.id === this.id);
    if (!existing) throw new Error(`MATERIAL_NOT_FOUND: ${this.id}`);
    this.prev = existing;
    useAppStore.getState().removeMaterial(this.id);
  }

  async revert(): Promise<void> {
    if (this.prev) {
      useAppStore.getState().addMaterial(this.prev);
      this.prev = null;
    }
  }
}
