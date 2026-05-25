// packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../../store/useAppStore';
import { AddDimensionGroupCommand } from '../AddDimensionGroupCommand';

/** One minimal sheet. Override per case (views/dimensions/annotations/etc.). */
function makeSheet(over: Partial<DrawingSheet> = {}): DrawingSheet {
  return {
    id: 'sheet-1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape', views: [], dimensions: [], dimensionGroups: [],
    annotations: [], titleBlock: {},
    ...over,
  } as DrawingSheet;
}

/** Minimal valid DrawingDocument. Override `sheets` per case. */
function makeDrawing(over: Partial<DrawingDocument> = {}): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [makeSheet()],
    activeSheetId: 'sheet-1',
    ...over,
  } as DrawingDocument;
}

/** Seed the store with a drawing via setActiveDocument so the baseline is already synced. */
function seedDrawing(doc: DrawingDocument): void {
  useAppStore.getState().setActiveDocument({ kind: 'drawing', document: doc });
}

interface Command { apply(): unknown | Promise<unknown>; revert(): unknown | Promise<unknown>; }

interface GuardCase {
  name: string;
  /** Seed the store AND return the constructed command. Baseline must be a synced drawing. */
  make: () => Command;
}

function expectSynced(label: string): void {
  const s = useAppStore.getState();
  expect(s.activeDocument?.kind, `${label}: activeDocument.kind`).toBe('drawing');
  if (s.activeDocument?.kind === 'drawing') {
    expect(s.activeDrawing, `${label}: activeDrawing must === activeDocument.document`)
      .toBe(s.activeDocument.document);
  }
}

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

const CASES: GuardCase[] = [
  // Positive control — already correct, must pass without any fix.
  {
    name: 'AddDimensionGroupCommand (control)',
    make: () => {
      seedDrawing(makeDrawing());
      return new AddDimensionGroupCommand({
        sheetId: 'sheet-1',
        group: baselineGroup,
      });
    },
  },
];

beforeEach(() => {
  useAppStore.setState({ activeDocument: null, activePart: null, activeAssembly: null, activeDrawing: null });
});

describe('activeDrawing invariant — every drawing command keeps activeDrawing === activeDocument.document', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const cmd = c.make();
      expectSynced('baseline');
      await cmd.apply();
      expectSynced('after apply');
      await cmd.revert();
      expectSynced('after revert');
    });
  }
});
