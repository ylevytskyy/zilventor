import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';

export class DeleteDimensionGroupCommand implements Command {
  readonly name = 'DeleteDimensionGroupCommand';

  // Saved for revert
  private savedGroup: DimensionGroup | null = null;
  private savedMembers: DrawingDimension[] = [];
  private savedMemberIndices: number[] = [];
  private savedGroupIndex = -1;

  constructor(private readonly opts: { sheetId: string; groupId: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    const groups = sheet.dimensionGroups ?? [];
    const groupIdx = groups.findIndex((g) => g.id === this.opts.groupId);
    if (groupIdx === -1) throw new Error('group-not-found');

    this.savedGroup = groups[groupIdx]!;
    this.savedGroupIndex = groupIdx;

    // Identify member dims (baseline or ordinate with matching groupId)
    const memberIndices: number[] = [];
    const members: DrawingDimension[] = [];
    sheet.dimensions.forEach((d, i) => {
      const gd = d as unknown as { groupId?: string };
      if (gd.groupId === this.opts.groupId) {
        memberIndices.push(i);
        members.push(d);
      }
    });
    this.savedMembers = members;
    this.savedMemberIndices = memberIndices;

    const memberIdSet = new Set(members.map((m) => m.id));

    const nextSheet = {
      ...sheet,
      dimensionGroups: groups.filter((g) => g.id !== this.opts.groupId),
      dimensions: sheet.dimensions.filter((d) => !memberIdSet.has(d.id)),
    };
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) => s.id === this.opts.sheetId ? nextSheet : s),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  async revert(): Promise<void> {
    if (!this.savedGroup) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) return;

    // Restore group at original index
    const groups = [...(sheet.dimensionGroups ?? [])];
    groups.splice(this.savedGroupIndex, 0, this.savedGroup!);

    // Restore members at their original indices (splice in forward order)
    const dims = [...sheet.dimensions];
    const sorted = this.savedMembers
      .map((m, i) => ({ m, idx: this.savedMemberIndices[i]! }))
      .sort((a, b) => a.idx - b.idx);
    for (const { m, idx } of sorted) {
      dims.splice(idx, 0, m);
    }

    const nextSheet = { ...sheet, dimensionGroups: groups, dimensions: dims };
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) => s.id === this.opts.sheetId ? nextSheet : s),
    };
    this.savedGroup = null;
    this.savedMembers = [];
    this.savedMemberIndices = [];
    this.savedGroupIndex = -1;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }
}
