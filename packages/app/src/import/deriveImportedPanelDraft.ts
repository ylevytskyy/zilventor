import type { MaterialId, PanelFeature, PartDocument } from '@zilventor/shared';

/**
 * Pure: derives a PanelFeature draft from an imported part's cached bounding
 * box, for the "Convert imported STEP part to panel" command. Smallest bbox
 * extent becomes thickness; the remaining two are sorted descending into
 * length (larger) / width (smaller) — deterministic, matches the "length is
 * the longer dimension" convention used elsewhere in panel creation.
 *
 * Mirrors buildAbfPanelPart's field defaults: no outline (bbox is always a
 * plain rectangle), grain 'none', no edge bands, thicknessFromMaterial false.
 */
export function deriveImportedPanelDraft(part: PartDocument, defaultMaterialId: MaterialId): PanelFeature | null {
  const hasImportedFeature = part.featureTree.some((f) => f.kind === 'imported');
  if (!hasImportedFeature) return null;

  const boundingBox = part.cachedGeometry?.boundingBox;
  if (!boundingBox) return null;

  const [minX, minY, minZ, maxX, maxY, maxZ] = boundingBox;
  const extents = [maxX - minX, maxY - minY, maxZ - minZ];
  if (extents.some((e) => !Number.isFinite(e) || e <= 0)) return null;

  const [length, width, thickness] = [...extents].sort((a, b) => b - a) as [number, number, number];

  return {
    kind: 'panel',
    id: crypto.randomUUID(),
    length: { kind: 'literal', value: length },
    width: { kind: 'literal', value: width },
    thickness: { kind: 'literal', value: thickness },
    thicknessFromMaterial: false,
    materialId: defaultMaterialId,
    grain: 'none',
    edgeBands: { front: null, back: null, left: null, right: null },
  };
}
