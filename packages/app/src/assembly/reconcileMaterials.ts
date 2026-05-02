import type { MaterialEntry, MaterialRegistry } from '@zilventor/shared';

export interface PanelMaterialRef {
  readonly panelFeatureId: string;
  readonly fieldKey: 'materialId' | `edgeBands.${'front' | 'back' | 'left' | 'right'}.materialId`;
  readonly materialId: string;
}

export interface PanelFeatureRefRewrite {
  readonly panelFeatureId: string;
  readonly fieldKey: PanelMaterialRef['fieldKey'];
  readonly newMaterialId: string;
}

export interface ReconcileResult {
  readonly updatedAssemblyMaterials: MaterialEntry[];
  readonly updatedPartFeatures: PanelFeatureRefRewrite[];
  readonly updatedPartMaterials: MaterialEntry[];
}

const matKey = (m: MaterialEntry) => `${m.name.trim().toLowerCase()}|${m.defaultThickness}`;

export function reconcileMaterials(
  partRegistry: MaterialRegistry,
  assemblyRegistry: MaterialRegistry,
  refs: readonly PanelMaterialRef[],
): ReconcileResult {
  const assemblyByKey = new Map<string, MaterialEntry>(
    assemblyRegistry.map((m) => [matKey(m), m]),
  );
  const partById = new Map<string, MaterialEntry>(partRegistry.map((m) => [m.id, m]));

  const rewrites: PanelFeatureRefRewrite[] = [];
  const newAssemblyEntries: MaterialEntry[] = [];
  const usedPartIds = new Set<string>();

  for (const ref of refs) {
    const partEntry = partById.get(ref.materialId);
    if (!partEntry) continue; // stale ref, skip
    usedPartIds.add(partEntry.id);
    const existing = assemblyByKey.get(matKey(partEntry));
    if (existing) {
      if (existing.id !== partEntry.id) {
        rewrites.push({
          panelFeatureId: ref.panelFeatureId,
          fieldKey: ref.fieldKey,
          newMaterialId: existing.id,
        });
      }
    } else {
      // Copy part entry into assembly registry, preserving id.
      newAssemblyEntries.push(partEntry);
      assemblyByKey.set(matKey(partEntry), partEntry);
    }
  }

  return {
    updatedAssemblyMaterials: [...assemblyRegistry, ...newAssemblyEntries],
    updatedPartFeatures: rewrites,
    updatedPartMaterials: partRegistry.filter((m) => usedPartIds.has(m.id)),
  };
}
