import type { DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type SheetLike = {
  dimensions: readonly DrawingDimension[];
  dimensionGroups?: readonly DimensionGroup[];
};

type GroupMemberDim = DrawingDimension & { groupId: string };

function isGroupMember(d: DrawingDimension): d is GroupMemberDim {
  return (d.kind === 'baseline' || d.kind === 'ordinate') &&
    typeof (d as unknown as { groupId?: string }).groupId === 'string';
}

/**
 * Assert F5 DimensionGroup invariants for a sheet.
 * Throws with a specific error string if any invariant is violated.
 * Called from command apply() to catch programming errors early.
 *
 * Invariants:
 *   1. orphaned-member — baseline/ordinate dim.groupId must resolve to a group.
 *   2. mismatched-kind — dim.kind must match group.kind.
 *   3. mismatched-viewId — dim.viewId must match group.viewId.
 */
export function assertDimensionGroupInvariants(sheet: SheetLike): void {
  const groups = sheet.dimensionGroups ?? [];
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  for (const d of sheet.dimensions) {
    if (!isGroupMember(d)) continue;
    const gd = d as unknown as { groupId: string };

    const group = groupMap.get(gd.groupId);
    if (!group) {
      throw new Error(`orphaned-member: dim ${d.id} references missing group ${gd.groupId}`);
    }
    if (group.kind !== d.kind) {
      throw new Error(
        `mismatched-kind: dim ${d.id} kind=${d.kind} but group ${group.id} kind=${group.kind}`,
      );
    }
    if (d.viewId !== group.viewId) {
      throw new Error(
        `mismatched-viewId: dim ${d.id} viewId=${d.viewId} but group ${group.id} viewId=${group.viewId}`,
      );
    }
  }
}
