import { describe, expect, it } from 'vitest';
import { reconcileMaterials } from '../reconcileMaterials';
import type { MaterialEntry } from '@zilventor/shared';

const ent = (id: string, name: string, t = 18, color = '#000000'): MaterialEntry =>
  ({ id, name, defaultThickness: t, color });

describe('reconcileMaterials', () => {
  it('empty registries → no rewrites, no copies', () => {
    const r = reconcileMaterials([], [], []);
    expect(r.updatedAssemblyMaterials).toEqual([]);
    expect(r.updatedPartFeatures).toEqual([]);
    expect(r.updatedPartMaterials).toEqual([]);
  });

  it('exact-match merge: rewrites part→assembly id', () => {
    const part = [ent('p1', 'Birch 18', 18, '#d8c896')];
    const asm  = [ent('a1', 'Birch 18', 18, '#d8c896')];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toEqual(asm);
    expect(r.updatedPartFeatures).toEqual([
      { panelFeatureId: 'pf-1', fieldKey: 'materialId', newMaterialId: 'a1' },
    ]);
  });

  it('no-match copy: copies part entry into assembly registry', () => {
    const part = [ent('p1', 'MDF 12', 12)];
    const asm: MaterialEntry[] = [];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toEqual([ent('p1', 'MDF 12', 12)]);
    // ID stays the same — no rewrite needed.
    expect(r.updatedPartFeatures).toEqual([]);
  });

  it('case-insensitive name matching', () => {
    const part = [ent('p1', 'BIRCH 18', 18)];
    const asm  = [ent('a1', 'birch 18', 18)];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedPartFeatures[0]!.newMaterialId).toBe('a1');
  });

  it('same-name-different-thickness treated as distinct', () => {
    const part = [ent('p1', 'Birch', 18)];
    const asm  = [ent('a1', 'Birch', 19)];  // different T
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toHaveLength(2);
    expect(r.updatedPartFeatures).toEqual([]);
  });

  it('multi-panel mixed exact + copy', () => {
    const part = [ent('p1', 'Birch', 18), ent('p2', 'PVC', 1)];
    const asm  = [ent('a1', 'Birch', 18)];
    const refs = [
      { panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' },
      { panelFeatureId: 'pf-2', fieldKey: 'materialId' as const, materialId: 'p2' },
    ];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toHaveLength(2);
    expect(r.updatedAssemblyMaterials.find(m => m.name === 'PVC')?.id).toBe('p2');
    expect(r.updatedPartFeatures).toEqual([
      { panelFeatureId: 'pf-1', fieldKey: 'materialId', newMaterialId: 'a1' },
    ]);
  });

  it('drops orphan entries from updatedPartMaterials', () => {
    const part = [ent('p1', 'Used', 18), ent('p2', 'Orphan', 12)];
    const asm: MaterialEntry[] = [];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedPartMaterials.map(m => m.id)).toEqual(['p1']);
  });
});
