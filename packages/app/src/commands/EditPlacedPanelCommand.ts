import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import type { NestState, NestSheet, PlacedPanel } from '@zilventor/shared';

export type PlacedPanelEdit =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'rotate' }
  | { type: 'flip' };

export class EditRejectedError extends Error {
  constructor(public readonly reason: 'bounds' | 'overlap') {
    super(`Edit rejected: ${reason}`);
    this.name = 'EditRejectedError';
  }
}

function computeCandidate(panel: PlacedPanel, edit: PlacedPanelEdit): PlacedPanel {
  switch (edit.type) {
    case 'move':
      return { ...panel, x: panel.x + edit.dx, y: panel.y + edit.dy };
    case 'rotate':
      return { ...panel, rotated: !panel.rotated, length: panel.width, width: panel.length };
    case 'flip': {
      const { mirrored, ...rest } = panel;
      return mirrored ? rest : { ...rest, mirrored: true };
    }
  }
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly width: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.length <= b.x ||
    b.x + b.length <= a.x ||
    a.y + a.width <= b.y ||
    b.y + b.width <= a.y
  );
}

export type PlacementEvaluation = { valid: true } | { valid: false; reason: 'bounds' | 'overlap' };

export function evaluatePlacement(candidate: Rect, sheet: NestSheet, panelArrayIndex: number): PlacementEvaluation {
  const withinBounds =
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x + candidate.length <= sheet.sheetLengthMm &&
    candidate.y + candidate.width <= sheet.sheetWidthMm;
  if (!withinBounds) return { valid: false, reason: 'bounds' };

  const overlaps = sheet.panels.some((o, i) => {
    if (i === panelArrayIndex) return false;
    return rectsOverlap(candidate, o);
  });
  if (overlaps) return { valid: false, reason: 'overlap' };

  return { valid: true };
}

function validate(candidate: PlacedPanel, sheet: NestSheet, panelArrayIndex: number): void {
  const result = evaluatePlacement(candidate, sheet, panelArrayIndex);
  if (!result.valid) throw new EditRejectedError(result.reason);
}

export class EditPlacedPanelCommand implements Command {
  readonly name = 'EditPlacedPanel';
  private prevNest: NestState | undefined;
  private applied = false;

  constructor(
    private readonly opts: {
      materialId: string;
      sheetIndex: number;
      panelArrayIndex: number;
      edit: PlacedPanelEdit;
    },
  ) {}

  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    const nest = a?.nest;
    if (!nest) throw new Error('No nest to edit');
    const sheetIdx = nest.sheets.findIndex(
      (s) => s.materialId === this.opts.materialId && s.sheetIndex === this.opts.sheetIndex,
    );
    if (sheetIdx === -1) throw new Error('Sheet not found');
    const sheet = nest.sheets[sheetIdx]!;
    const panel = sheet.panels[this.opts.panelArrayIndex];
    if (!panel) throw new Error('Panel not found');

    const candidate = computeCandidate(panel, this.opts.edit);
    validate(candidate, sheet, this.opts.panelArrayIndex);

    this.prevNest = nest;

    const nextPanels = sheet.panels.map((p, i) => (i === this.opts.panelArrayIndex ? candidate : p));

    const dropsRemnant =
      this.opts.edit.type !== 'flip' && sheet.remnant !== undefined && rectsOverlap(candidate, sheet.remnant);
    const { remnant: _remnant, ...sheetWithoutRemnant } = sheet;
    const nextSheet: NestSheet = {
      ...(dropsRemnant ? sheetWithoutRemnant : sheet),
      panels: nextPanels,
      manuallyEdited: true,
    };
    const nextSheets = nest.sheets.map((s, i) => (i === sheetIdx ? nextSheet : s));
    const nextNest: NestState = { ...nest, sheets: nextSheets };

    useAppStore.setState((s) => {
      if (!s.activeAssembly) return s;
      const nextDoc = { ...s.activeAssembly, nest: nextNest };
      return {
        activeDocument: { kind: 'assembly' as const, document: nextDoc },
        activeAssembly: nextDoc,
      } as never;
    });
    this.applied = true;
  }

  async revert(): Promise<void> {
    if (!this.applied) return;
    const prevNest = this.prevNest;
    useAppStore.setState((s) => {
      if (!s.activeAssembly) return s;
      const nextDoc = { ...s.activeAssembly, nest: prevNest };
      return {
        activeDocument: { kind: 'assembly' as const, document: nextDoc },
        activeAssembly: nextDoc,
      } as never;
    });
  }
}
