/**
 * buildShakerDoor — pack a framed (shaker) door .ziasm + nested member .zipt files
 * to OPFS. Modeled on buildDrawerBox (присадка slice 4 SEAM).
 *
 * The 5 members (2 stiles, 2 rails, 1 center panel) come from
 * framedDoorMath.computeShakerParts. Their poses are in the door's part-local
 * frame (identity quaternions); the caller places the whole .ziasm at the slab
 * door's pose, so the nested-sub-assembly quaternion composition (composedPoses)
 * lands the frame upright at the cabinet front — exactly where a slab door sits.
 *
 * Each member .zipt carries a PanelFeature so the recursive cut-list walker
 * (aggregateCutListRecursive) surfaces it as a real row.
 */

import type { AssemblyDocument, ComponentInstance, GrooveFeature, GrooveSpec, PanelFeature, PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { ShakerPart, ShakerResult } from '@zilventor/shared/src/framedDoorMath';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};

export interface BuildShakerDoorMeta {
  /** Unique door identifier used to derive unique OPFS paths for the 5 members. */
  doorId: string;
  /** Human-readable name for the door assembly. */
  name: string;
  /** Material id for the frame members (defaults to 'm' if absent). */
  materialId?: string;
  /** Groove rebate(s) appended to the center panel's featureTree (raised-panel style). */
  centerPanelGrooves?: GrooveSpec[];
}

export interface BuildShakerDoorResult {
  /** Packed .ziasm bytes for the door sub-assembly. */
  bytes: Uint8Array;
  /** OPFS paths of the 5 member .zipt files written. */
  memberPaths: string[];
  /** PartDocument ids of the 5 members (for kernel register/delete). */
  memberPartIds: string[];
  /** The 5 member PartDocuments (for kernel registration by the caller). */
  memberDocs: PartDocument[];
}

export async function buildShakerDoor(
  shaker: ShakerResult,
  meta: BuildShakerDoorMeta,
  opfs: OpfsRWD,
): Promise<BuildShakerDoorResult> {
  const materialId = meta.materialId ?? 'm';
  const memberPaths: string[] = [];
  const memberPartIds: string[] = [];
  const memberDocs: PartDocument[] = [];
  const components: ComponentInstance[] = [];

  for (let i = 0; i < shaker.parts.length; i++) {
    const part = shaker.parts[i]!;
    const memberName = memberNameFor(meta.doorId, part, i);
    const memberPath = `${memberName}.zipt`;

    const panelFeature: PanelFeature = {
      kind: 'panel',
      id: 'panel',
      length: { kind: 'literal', value: part.dims.length },
      width: { kind: 'literal', value: part.dims.width },
      thickness: { kind: 'literal', value: part.dims.thickness },
      thicknessFromMaterial: false,
      materialId,
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    let partDoc: PartDocument = addFeature(newPart(memberName), panelFeature);

    // Raised-panel rebate: append groove features to the center panel only.
    if (part.role === 'doorCenterPanel' && meta.centerPanelGrooves?.length) {
      meta.centerPanelGrooves.forEach((spec, gi) => {
        const feature: GrooveFeature = { kind: 'groove', id: `rebate-${gi}`, ...spec };
        partDoc = addFeature(partDoc, feature);
      });
    }

    const bytes = await packProject({
      manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc },
      blobs: {},
    });
    await opfs.write(memberPath, bytes);
    memberPaths.push(memberPath);
    memberPartIds.push(partDoc.id);
    memberDocs.push(partDoc);

    components.push({
      id: `${meta.doorId}-m${i}`,
      partPath: memberPath,
      position: {
        x: part.pose.translation.x,
        y: part.pose.translation.y,
        z: part.pose.translation.z,
      },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      pose: part.pose,
      role: part.role,
    });
  }

  const doorDoc: AssemblyDocument = {
    id: `${meta.doorId}-asm`,
    name: meta.name,
    units: 'mm',
    parameters: {},
    properties: {},
    components,
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    materials: [],
    hardware: [],
  };

  const asmBytes = await packAssembly(doorDoc, new Uint8Array());
  return { bytes: asmBytes, memberPaths, memberPartIds, memberDocs };
}

/** Derive a unique, stable member file name from the door id and part definition. */
function memberNameFor(doorId: string, part: ShakerPart, index: number): string {
  const slug =
    part.role === 'doorStile' ? (part.isLeft ? 'stile-L' : 'stile-R')
    : part.role === 'doorRail' ? (part.isTop ? 'rail-T' : 'rail-B')
    : 'panel';
  return `${doorId}-${slug}-${index}`;
}
