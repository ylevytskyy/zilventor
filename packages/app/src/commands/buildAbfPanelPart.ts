import type { BoreOp, Feature, MaterialId, PanelFeature, PartDocument, SketchPrimitive } from '@zilventor/shared';
import type { AbfPanelRecord } from '@zilventor/shared/src/dxf/abfPanelExtraction';
import { addFeature, newPart } from '@zilventor/kernel/src/adapter/PartDocument';

export interface BuildAbfPanelPartOpts {
  /** Dialog-supplied (S4) material selection for this panel's material group. */
  readonly materialId: MaterialId;
  /** Dialog-supplied (S4) thickness for this panel's material group, mm. */
  readonly thickness: number;
}

/**
 * Builds a manifest-only `PartDocument` from one S1 `AbfPanelRecord`, the
 * `CreateAndPlacePanelCommand` way (no kernel B-rep, no `kernel.registerPart`):
 * `newPart()` + `addFeature(panel)`, mirroring plan §5's architectural correction.
 *
 * - `PanelFeature.outline` is populated only when the record is non-rectangular
 *   (plan §3's flagged-not-solved risk) — absent (plain box) otherwise.
 * - `kind:'bore'` circles become `PartDocument.bores` entries (v1 face bores only).
 * - `kind:'reference'` circles land as plain (non-extruded) sketch circle
 *   primitives in a trailing `sketch` feature — reference geometry only, per
 *   plan §6d — never as `BoreOp`s.
 */
export function buildAbfPanelPart(record: AbfPanelRecord, opts: BuildAbfPanelPartOpts): PartDocument {
  const panel: PanelFeature = {
    kind: 'panel',
    id: crypto.randomUUID(),
    length: { kind: 'literal', value: record.length },
    width: { kind: 'literal', value: record.width },
    thickness: { kind: 'literal', value: opts.thickness },
    thicknessFromMaterial: false,
    materialId: opts.materialId,
    grain: 'none',
    edgeBands: { front: null, back: null, left: null, right: null },
    ...(record.rectangular ? {} : { outline: record.outline }),
  };

  let part = addFeature(newPart(record.name), panel);

  const bores: BoreOp[] = [];
  const referenceCircles: SketchPrimitive[] = [];
  record.circles.forEach((c, i) => {
    if (c.kind === 'bore') {
      bores.push({
        id: `abf-bore-${i}`,
        face: { featureId: 'panel', role: c.faceRole, instance: 0 },
        u: c.u,
        v: c.v,
        diameter: c.diameter,
        depth: c.depth,
        role: c.role,
        connectorId: `abf-bore-${i}`,
        connectorKind: c.connectorKind,
        ...(c.sku !== undefined ? { sku: c.sku } : {}),
      });
    } else {
      referenceCircles.push({
        id: `abf-ref-${i}`,
        kind: 'circle',
        cx: c.x,
        cy: c.y,
        r: c.diameter / 2,
      });
    }
  });

  if (bores.length > 0) {
    part = { ...part, bores };
  }

  if (referenceCircles.length > 0) {
    const sketchFeature: Feature = {
      kind: 'sketch',
      id: crypto.randomUUID(),
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: referenceCircles,
      constraints: [],
    };
    part = addFeature(part, sketchFeature);
  }

  return part;
}
