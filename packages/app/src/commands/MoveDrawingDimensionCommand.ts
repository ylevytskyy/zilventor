import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';

type BaselineDim  = DrawingDimension & { kind: 'baseline';  groupId: string };
type OrdinateDim  = DrawingDimension & { kind: 'ordinate';  groupId: string; axis: 'x' | 'y' };

export class MoveDrawingDimensionCommand implements Command {
  readonly name = 'MoveDrawingDimension';

  // Prior state for revert — one of three cases:
  private prevDimOffsetMm: number | undefined;
  private prevDimAngleDeg: number | undefined;
  private prevGroupOffsetMm: number | undefined;   // for baseline
  private prevXColumnOffsetMm: number | undefined; // for ordinate x
  private prevYColumnOffsetMm: number | undefined; // for ordinate y
  private movedKind: 'dim' | 'baseline-group' | 'ordinate-x' | 'ordinate-y' = 'dim';
  private movedGroupId: string | undefined;

  constructor(private readonly opts: {
    sheetId: string;
    dimId: string;
    offsetMm: number;
    angleDeg?: number;
  }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) return;

    const dim = sheet.dimensions.find((d) => d.id === this.opts.dimId);
    if (!dim) return;

    if (dim.kind === 'baseline') {
      const bd = dim as unknown as BaselineDim;
      const groups = sheet.dimensionGroups ?? [];
      const gIdx = groups.findIndex((g) => g.id === bd.groupId);
      if (gIdx === -1) return;
      const group = groups[gIdx] as Extract<DimensionGroup, { kind: 'baseline' }>;
      this.prevGroupOffsetMm = group.baseOffsetMm;
      this.movedKind = 'baseline-group';
      this.movedGroupId = bd.groupId;

      const nextGroup = { ...group, baseOffsetMm: this.opts.offsetMm };
      const nextGroups = groups.map((g, i) => i === gIdx ? nextGroup : g);
      const nextDoc: DrawingDocument = {
        ...doc.document,
        sheets: doc.document.sheets.map((s) =>
          s.id === this.opts.sheetId ? { ...s, dimensionGroups: nextGroups } : s,
        ),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    if (dim.kind === 'ordinate') {
      const od = dim as unknown as OrdinateDim;
      const groups = sheet.dimensionGroups ?? [];
      const gIdx = groups.findIndex((g) => g.id === od.groupId);
      if (gIdx === -1) return;
      const group = groups[gIdx] as Extract<DimensionGroup, { kind: 'ordinate' }>;
      this.movedGroupId = od.groupId;

      let nextGroup: DimensionGroup;
      if (od.axis === 'x') {
        this.prevXColumnOffsetMm = group.xColumnOffsetMm;
        this.movedKind = 'ordinate-x';
        nextGroup = { ...group, xColumnOffsetMm: this.opts.offsetMm };
      } else {
        this.prevYColumnOffsetMm = group.yColumnOffsetMm;
        this.movedKind = 'ordinate-y';
        nextGroup = { ...group, yColumnOffsetMm: this.opts.offsetMm };
      }

      const nextGroups = groups.map((g, i) => i === gIdx ? nextGroup : g);
      const nextDoc: DrawingDocument = {
        ...doc.document,
        sheets: doc.document.sheets.map((s) =>
          s.id === this.opts.sheetId ? { ...s, dimensionGroups: nextGroups } : s,
        ),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    // angular and all legacy dim kinds: mutate dim.offsetMm (and optionally angleDeg)
    this.movedKind = 'dim';
    this.prevDimOffsetMm = (dim as { offsetMm: number }).offsetMm;
    this.prevDimAngleDeg = (dim as { angleDeg?: number }).angleDeg;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const dimensions = sh.dimensions.map((d) => {
        if (d.id !== this.opts.dimId) return d;
        const updated = { ...d, offsetMm: this.opts.offsetMm } as DrawingDimension;
        if (this.opts.angleDeg !== undefined && 'angleDeg' in d) {
          return { ...updated, angleDeg: this.opts.angleDeg } as DrawingDimension;
        }
        return updated;
      });
      return { ...sh, dimensions };
    });
    const nextDoc: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    if (this.movedKind === 'baseline-group' && this.movedGroupId !== undefined && this.prevGroupOffsetMm !== undefined) {
      const prevOffset = this.prevGroupOffsetMm;
      const groupId = this.movedGroupId;
      const sheets = doc.document.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const dimensionGroups = (sh.dimensionGroups ?? []).map((g) =>
          g.id === groupId && g.kind === 'baseline'
            ? { ...g, baseOffsetMm: prevOffset }
            : g,
        );
        return { ...sh, dimensionGroups };
      });
      const nextDoc: DrawingDocument = { ...doc.document, sheets };
      this.prevGroupOffsetMm = undefined;
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    if ((this.movedKind === 'ordinate-x' || this.movedKind === 'ordinate-y') && this.movedGroupId !== undefined) {
      const kind = this.movedKind;
      const groupId = this.movedGroupId;
      const prevX = this.prevXColumnOffsetMm;
      const prevY = this.prevYColumnOffsetMm;
      const sheets = doc.document.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const dimensionGroups = (sh.dimensionGroups ?? []).map((g) => {
          if (g.id !== groupId || g.kind !== 'ordinate') return g;
          if (kind === 'ordinate-x' && prevX !== undefined) return { ...g, xColumnOffsetMm: prevX };
          if (kind === 'ordinate-y' && prevY !== undefined) return { ...g, yColumnOffsetMm: prevY };
          return g;
        });
        return { ...sh, dimensionGroups };
      });
      const nextDoc: DrawingDocument = { ...doc.document, sheets };
      this.prevXColumnOffsetMm = undefined;
      this.prevYColumnOffsetMm = undefined;
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    // Legacy dim revert
    if (this.prevDimOffsetMm === undefined) return;
    const prevOffsetMm = this.prevDimOffsetMm;
    const prevAngleDeg = this.prevDimAngleDeg;
    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const dimensions = sh.dimensions.map((d) => {
        if (d.id !== this.opts.dimId) return d;
        const restored = { ...d, offsetMm: prevOffsetMm } as DrawingDimension;
        if (prevAngleDeg !== undefined && 'angleDeg' in d) {
          return { ...restored, angleDeg: prevAngleDeg } as DrawingDimension;
        }
        return restored;
      });
      return { ...sh, dimensions };
    });
    const nextDoc: DrawingDocument = { ...doc.document, sheets };
    this.prevDimOffsetMm = undefined;
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }
}
