import type { BoreOp } from '@zilventor/shared';

export interface ConnectorMemberFull {
  bore: BoreOp;
  partPath: string;
  doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] };
  panelDims: { length: number; width: number; thickness: number };
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
}

/**
 * Collects every bore sharing `connectorId` across all provided docs.
 * Used by BorePropertiesPanel to build MoveConnectorCommand and DeleteConnectorCommand opts.
 *
 * @param connectorId  - The connectorId to look up (bore.connectorId).
 * @param docs         - Array of { partPath, doc, panelDims, worldPose } for all candidate docs.
 *                       Typically built from the markerSpecs already in scope in App.tsx.
 * @returns Array of ConnectorMemberFull for every bore with matching connectorId, in doc order.
 *          Empty if no match.
 */
export function collectConnectorMembers(
  connectorId: string,
  docs: Array<{
    partPath: string;
    doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] };
    panelDims: { length: number; width: number; thickness: number };
    worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
  }>,
): ConnectorMemberFull[] {
  const result: ConnectorMemberFull[] = [];
  for (const entry of docs) {
    for (const bore of entry.doc.bores ?? []) {
      if (bore.connectorId === connectorId) {
        result.push({
          bore,
          partPath: entry.partPath,
          doc: entry.doc,
          panelDims: entry.panelDims,
          worldPose: entry.worldPose,
        });
      }
    }
  }
  return result;
}
