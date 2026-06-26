import type { HardwareFeature } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';
import { newPart, addFeature, setParameter } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';

/**
 * Synthesizes a full, renderable `.zipt` part for a hardware catalog entry.
 *
 * Produces: 7 origin features + sketch (bbox rectangle) + extrude (bbox height)
 * + HardwareFeature = 10 features total.
 *
 * Both AddHardwareCommand and CreateCabinetCommand write the same content
 * via this helper so that the exists-guard in each command cannot produce a
 * geometry-less placeholder when the other command has already created the file.
 */
export async function synthesizeHardwarePartBytes(
  entry: ReturnType<typeof resolveHardwareCatalog>[number],
): Promise<Uint8Array> {
  const { l, w, h } = entry.bboxMm;
  const sketchId = `hw-bbox-sketch-${entry.id}`;
  const extrudeId = `hw-bbox-extrude-${entry.id}`;

  // 1. Start with the 7 origin features.
  let partDoc = newPart(`hardware-${entry.id}`);

  // 2. Add a parameter for the extrude distance (bbox height).
  partDoc = setParameter(partDoc, { name: 'hw_h', expression: String(h), value: h, unit: 'mm' });

  // 3. Add a sketch on origin.XY containing a rectangle (0,0)→(l,w).
  partDoc = addFeature(partDoc, {
    kind: 'sketch',
    id: sketchId,
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'hw-bbox-rect', kind: 'rectangle', x: 0, y: 0, w: l, h: w }],
    constraints: [],
  });

  // 4. Add an extrude of the sketch by hw_h along +Z.
  partDoc = addFeature(partDoc, {
    kind: 'extrude',
    id: extrudeId,
    sketchRef: sketchId,
    distanceParam: 'hw_h',
    direction: 'forward',
    operation: 'new',
  });

  // 5. Add the HardwareFeature (semantic metadata for BOM/Cut List).
  const hwFeature: HardwareFeature = {
    kind: 'hardware',
    id: `hf-${entry.id}`,
    hardwareSkuId: entry.id,
    bboxMm: entry.bboxMm,
    attachPoints: entry.attachPoints,
  };
  partDoc = addFeature(partDoc, hwFeature as never);

  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'part' as const,
    document: partDoc,
  };
  return writeTarGz([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
}
