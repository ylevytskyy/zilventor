// packages/app/src/commands/__tests__/RemoveDxfUnderlayCommand.spec.ts
// SLICE 1 RED: RemoveDxfUnderlayCommand unit tests
import { describe, it, expect, beforeEach } from 'vitest';
import { RemoveDxfUnderlayCommand } from '../RemoveDxfUnderlayCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DxfUnderlay } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const EXISTING_UNDERLAY: DxfUnderlay = {
  name: 'floor-plan',
  entities: [
    { kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
    { kind: 'circle', cx: 50, cy: 50, r: 10 },
  ],
};

function makeDrawingDoc(underlay?: DxfUnderlay): DrawingDocument {
  const sheet = {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A3' as const },
    orientation: 'landscape' as const,
    views: [],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
    ...(underlay !== undefined ? { underlay } : {}),
  };
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [sheet],
  };
}

function setActiveDrawingDoc(doc: DrawingDocument) {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: doc },
    activeDrawing: doc,
  } as never);
}

beforeEach(() => {
  setActiveDrawingDoc(makeDrawingDoc(EXISTING_UNDERLAY));
});

describe('RemoveDxfUnderlayCommand', () => {
  it('(a) apply() removes underlay from active sheet — key absent, not undefined', async () => {
    const cmd = new RemoveDxfUnderlayCommand({});
    await cmd.apply();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;

    // Key must be absent entirely (not just set to undefined)
    expect('underlay' in sheet).toBe(false);
  });

  it('(b) apply() updates BOTH activeDocument.document and activeDrawing (drawingDocState invariant)', async () => {
    const cmd = new RemoveDxfUnderlayCommand({});
    await cmd.apply();

    const state = useAppStore.getState();
    const docState = state.activeDocument as unknown as DrawingActive;
    expect(state.activeDrawing).toBe(docState.document);
  });

  it('(c) revert() restores the prior underlay with its entities intact', async () => {
    const cmd = new RemoveDxfUnderlayCommand({});
    await cmd.apply();
    await cmd.revert();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;

    expect(sheet.underlay).toEqual(EXISTING_UNDERLAY);
    expect(sheet.underlay!.entities).toHaveLength(2);
  });

  it('(d) revert() also maintains drawingDocState invariant', async () => {
    const cmd = new RemoveDxfUnderlayCommand({});
    await cmd.apply();
    await cmd.revert();

    const state = useAppStore.getState();
    const docState = state.activeDocument as unknown as DrawingActive;
    expect(state.activeDrawing).toBe(docState.document);
  });

  it('(e) apply() on a sheet with NO underlay is a safe no-op (no crash)', async () => {
    // Reset to a doc without underlay
    setActiveDrawingDoc(makeDrawingDoc(undefined));

    const cmd = new RemoveDxfUnderlayCommand({});
    await expect(cmd.apply()).resolves.toBeUndefined();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    expect('underlay' in doc.sheets[0]!).toBe(false);
  });

  it('(f) command.name is "RemoveDxfUnderlay"', () => {
    const cmd = new RemoveDxfUnderlayCommand({});
    expect(cmd.name).toBe('RemoveDxfUnderlay');
  });

  it('(g) apply() when no drawing is active is a no-op (no crash)', async () => {
    useAppStore.setState({ activeDocument: null } as never);
    const cmd = new RemoveDxfUnderlayCommand({});
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
