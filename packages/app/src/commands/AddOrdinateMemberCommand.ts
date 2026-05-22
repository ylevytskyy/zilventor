import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';
import { assertDimensionGroupInvariants } from './dimensionGroupInvariants';

export class AddOrdinateMemberCommand implements Command {
  readonly name = 'AddOrdinateMemberCommand';
  private placedId: string | null = null;

  constructor(private readonly opts: {
    sheetId: string;
    groupId: string;
    to: PointRef;
    axis: 'x' | 'y';
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
    if (group.kind !== 'ordinate') throw new Error('wrong-kind');

    const id = crypto.randomUUID();
    this.placedId = id;

    const newDim: Extract<DrawingDimension, { kind: 'ordinate' }> = {
      id,
      kind: 'ordinate',
      viewId: group.viewId,
      groupId: this.opts.groupId,
      to: this.opts.to,
      axis: this.opts.axis,
      ...(this.opts.opts?.sourceParameterName !== undefined
        ? { sourceParameterName: this.opts.opts.sourceParameterName }
        : {}),
      ...(this.opts.opts?.textOverride !== undefined
        ? { textOverride: this.opts.opts.textOverride }
        : {}),
    };

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
