import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';
import { assertDimensionGroupInvariants } from './dimensionGroupInvariants';

export class AddBaselineMemberCommand implements Command {
  readonly name = 'AddBaselineMemberCommand';
  private placedId: string | null = null;

  constructor(private readonly opts: {
    sheetId: string;
    groupId: string;
    to: PointRef;
    opts?: { sourceParameterName?: string; textOverride?: string };
  }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    const groups = sheet.dimensionGroups ?? [];
    const group = groups.find((g) => g.id === this.opts.groupId);
    if (!group) throw new Error('group-not-found');
    if (group.kind !== 'baseline') throw new Error('wrong-kind');

    // Compute next slot: max of existing member slots for this groupId, then +1
    const existingSlots = (sheet.dimensions as unknown as Array<{ kind: string; groupId: string; slot: number }>)
      .filter((d) => d.kind === 'baseline' && d.groupId === this.opts.groupId)
      .map((d) => d.slot);
    const slot = existingSlots.length === 0 ? 0 : Math.max(...existingSlots) + 1;

    const id = crypto.randomUUID();
    this.placedId = id;

    const newDim = {
      id,
      kind: 'baseline' as const,
      viewId: group.viewId,
      groupId: this.opts.groupId,
      slot,
      to: this.opts.to,
      ...(this.opts.opts?.sourceParameterName !== undefined
        ? { sourceParameterName: this.opts.opts.sourceParameterName }
        : {}),
      ...(this.opts.opts?.textOverride !== undefined
        ? { textOverride: this.opts.opts.textOverride }
        : {}),
    } as unknown as DrawingDimension;

    const nextSheet = { ...sheet, dimensions: [...sheet.dimensions, newDim] };

    assertDimensionGroupInvariants(nextSheet);

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
    if (!this.placedId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const id = this.placedId;
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) =>
        s.id === this.opts.sheetId
          ? { ...s, dimensions: s.dimensions.filter((d) => d.id !== id) }
          : s,
      ),
    };
    this.placedId = null;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }
}
