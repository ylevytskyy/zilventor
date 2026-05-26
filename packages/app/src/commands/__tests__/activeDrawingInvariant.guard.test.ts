// packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// AddBaseViewCommand now calls projectViewFromSource (needs kernel).
// The guard test only checks the activeDrawing invariant, not projection behaviour,
// so mock it out to return a minimal result.
vi.mock('../../drawing/projectViewFromSource', () => ({
  projectViewFromSource: vi.fn().mockResolvedValue({
    projection: {
      visibleEdges: [],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    },
    inputFingerprint: 'guard-test-fp',
  }),
}));
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../../store/useAppStore';
import { AddDimensionGroupCommand } from '../AddDimensionGroupCommand';
import { AddBaseViewCommand } from '../AddBaseViewCommand';
import { AddProjectedViewCommand } from '../AddProjectedViewCommand';
import { AddIsoViewCommand } from '../AddIsoViewCommand';
import { DeleteViewCommand } from '../DeleteViewCommand';
import { RegenerateViewCommand } from '../RegenerateViewCommand';
import { MoveViewCommand } from '../MoveViewCommand';
import { EditViewScaleCommand } from '../EditViewScaleCommand';
import { ToggleHiddenLinesCommand } from '../ToggleHiddenLinesCommand';
import { AddDrawingAnnotationCommand } from '../AddDrawingAnnotationCommand';
import { DeleteDrawingAnnotationCommand } from '../DeleteDrawingAnnotationCommand';
import { MoveDrawingAnnotationCommand } from '../MoveDrawingAnnotationCommand';
import { AddDrawingDimensionCommand } from '../AddDrawingDimensionCommand';
import { DeleteDrawingDimensionCommand } from '../DeleteDrawingDimensionCommand';
import { AddSheetCommand } from '../AddSheetCommand';
import { DeleteSheetCommand } from '../DeleteSheetCommand';
import { RenameSheetCommand } from '../RenameSheetCommand';
import { EditSheetSizeCommand } from '../EditSheetSizeCommand';
import { EditDrawingPropertiesCommand } from '../EditDrawingPropertiesCommand';
import { EditTitleBlockCommand } from '../EditTitleBlockCommand';
import { SetActiveSheetCommand } from '../SetActiveSheetCommand';

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

  // B1: 8 view commands
  {
    name: 'AddBaseViewCommand',
    make: () => {
      seedDrawing(makeDrawing());
      return new AddBaseViewCommand({
        sheetId: 'sheet-1',
        positionMm: { x: 50, y: 60 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
      });
    },
  },
  {
    name: 'AddProjectedViewCommand',
    make: () => {
      // precondition: a base view present (else BASE_VIEW_NOT_FOUND)
      const baseView = {
        id: 'base-1', kind: 'base' as const,
        positionMm: { x: 100, y: 100 },
        orientation: 'front' as const,
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [baseView] })] }));
      return new AddProjectedViewCommand({
        sheetId: 'sheet-1',
        baseViewId: 'base-1',
        direction: 'right',
        positionMm: { x: 200, y: 100 },
      });
    },
  },
  {
    name: 'AddIsoViewCommand',
    make: () => {
      seedDrawing(makeDrawing());
      return new AddIsoViewCommand({
        sheetId: 'sheet-1',
        positionMm: { x: 200, y: 200 },
        corner: 'NE',
        scale: { numerator: 1, denominator: 1 },
      });
    },
  },
  {
    name: 'DeleteViewCommand',
    make: () => {
      // precondition: view must exist (else no-ops with no setState)
      const view = {
        id: 'v1', kind: 'base' as const,
        positionMm: { x: 10, y: 10 },
        orientation: 'front' as const,
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view] })] }));
      return new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'v1' });
    },
  },
  {
    name: 'RegenerateViewCommand',
    make: () => {
      // precondition: view must exist (else no-ops with no setState)
      const view = {
        id: 'view-1', kind: 'base' as const,
        positionMm: { x: 50, y: 50 },
        orientation: 'front' as const,
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline' as const, points: [[0, 0], [100, 0]] as [number, number][], sourceFaceIds: [] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
        },
        inputFingerprint: 'old-fp',
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view] })] }));
      return new RegenerateViewCommand({
        sheetId: 'sheet-1',
        viewId: 'view-1',
        projection: {
          visibleEdges: [{ id: 'e2', kind: 'outline' as const, points: [[0, 0], [120, 0]] as [number, number][], sourceFaceIds: [] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 120, maxY: 60 },
        },
        inputFingerprint: 'new-fp',
      });
    },
  },
  {
    name: 'MoveViewCommand',
    make: () => {
      // precondition: view must exist (else no-ops with no setState)
      const view = {
        id: 'view-1', kind: 'base' as const,
        positionMm: { x: 50, y: 50 },
        orientation: 'front' as const,
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view] })] }));
      return new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'view-1', positionMm: { x: 150, y: 200 } });
    },
  },
  {
    name: 'EditViewScaleCommand',
    make: () => {
      // precondition: view must exist (else no-ops with no setState)
      const view = {
        id: 'view-1', kind: 'base' as const,
        positionMm: { x: 50, y: 50 },
        orientation: 'front' as const,
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
        inputFingerprint: 'fp-old',
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view] })] }));
      return new EditViewScaleCommand({ sheetId: 'sheet-1', viewId: 'view-1', scale: { numerator: 1, denominator: 2 } });
    },
  },
  {
    name: 'ToggleHiddenLinesCommand',
    make: () => {
      // precondition: view must exist (else no-ops with no setState)
      const view = {
        id: 'view-1', kind: 'base' as const,
        positionMm: { x: 50, y: 50 },
        orientation: 'front' as const,
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view] })] }));
      return new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'view-1', showHidden: false });
    },
  },

  // B2: 5 annotation/dimension commands
  {
    name: 'AddDrawingAnnotationCommand',
    make: () => {
      seedDrawing(makeDrawing());
      const ann = {
        id: 'ann1', kind: 'leader' as const, viewId: 'v1',
        targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
      };
      return new AddDrawingAnnotationCommand({ sheetId: 'sheet-1', ann });
    },
  },
  {
    name: 'DeleteDrawingAnnotationCommand',
    make: () => {
      // precondition: annotation must exist (else no-op, no setState)
      const ann = {
        id: 'annA', kind: 'leader' as const, viewId: 'v1',
        targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ annotations: [ann] })] }));
      return new DeleteDrawingAnnotationCommand({ sheetId: 'sheet-1', annId: 'annA' });
    },
  },
  {
    name: 'MoveDrawingAnnotationCommand',
    make: () => {
      // precondition: annotation must exist (else no-op, priorAnn never set)
      const ann = {
        id: 'ann1', kind: 'leader' as const, viewId: 'v1',
        targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ annotations: [ann] })] }));
      return new MoveDrawingAnnotationCommand({ sheetId: 'sheet-1', annId: 'ann1', textPosMm: { x: 120, y: 60 } });
    },
  },
  {
    name: 'AddDrawingDimensionCommand',
    make: () => {
      seedDrawing(makeDrawing());
      const dim = {
        id: 'dim1', kind: 'linear-h' as const, viewId: 'v1',
        from: { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'start' as const },
        to:   { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'end' as const },
        offsetMm: 10,
      };
      return new AddDrawingDimensionCommand({ sheetId: 'sheet-1', dim });
    },
  },
  {
    name: 'DeleteDrawingDimensionCommand',
    make: () => {
      // precondition: dimension must exist (else no-op, no setState)
      const dim = {
        id: 'dA', kind: 'linear-h' as const, viewId: 'v1',
        from: { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'start' as const },
        to:   { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'end' as const },
        offsetMm: 10,
      };
      seedDrawing(makeDrawing({ sheets: [makeSheet({ dimensions: [dim] })] }));
      return new DeleteDrawingDimensionCommand({ sheetId: 'sheet-1', dimId: 'dA' });
    },
  },

  // B3: 6 sheet/properties commands + SetActiveSheet inverse offender
  {
    name: 'AddSheetCommand',
    make: () => { seedDrawing(makeDrawing()); return new AddSheetCommand({}); },
  },
  {
    name: 'DeleteSheetCommand',
    make: () => {
      // precondition: ≥2 sheets (else throws LAST_SHEET)
      const sheet2 = makeSheet({ id: 'sheet-2', name: 'Sheet 2' });
      seedDrawing(makeDrawing({ sheets: [makeSheet(), sheet2], activeSheetId: 'sheet-1' }));
      return new DeleteSheetCommand({ sheetId: 'sheet-2' });
    },
  },
  {
    name: 'RenameSheetCommand',
    make: () => { seedDrawing(makeDrawing()); return new RenameSheetCommand({ sheetId: 'sheet-1', name: 'Renamed' }); },
  },
  {
    name: 'EditSheetSizeCommand',
    make: () => {
      seedDrawing(makeDrawing());
      return new EditSheetSizeCommand({ sheetId: 'sheet-1', size: { kind: 'iso', size: 'A4' }, orientation: 'portrait' });
    },
  },
  {
    name: 'EditDrawingPropertiesCommand',
    make: () => { seedDrawing(makeDrawing()); return new EditDrawingPropertiesCommand({ properties: { author: 'X' } }); },
  },
  {
    name: 'EditTitleBlockCommand',
    make: () => {
      seedDrawing(makeDrawing());
      return new EditTitleBlockCommand({ sheetId: 'sheet-1', overrides: { drawingName: 'T' } });
    },
  },
  {
    name: 'SetActiveSheetCommand (inverse offender)',
    make: () => {
      // precondition: ≥2 sheets so switching is meaningful; seedDrawing sets activeDrawing correctly at baseline
      const sheet2 = makeSheet({ id: 'sheet-2', name: 'Sheet 2' });
      seedDrawing(makeDrawing({ sheets: [makeSheet(), sheet2], activeSheetId: 'sheet-1' }));
      return new SetActiveSheetCommand({ sheetId: 'sheet-2' });
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
