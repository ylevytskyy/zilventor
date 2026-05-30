// packages/app/src/commands/__tests__/AddBaseViewCommand.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddBaseViewCommand } from '../AddBaseViewCommand';
import type { DrawingDocument } from '@zilventor/shared';
import { projectViewFromSource } from '../../drawing/projectViewFromSource';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

/** 8 points on a circle of radius 5mm centred at (10,10). */
function arcPoints(cx = 10, cy = 10, r = 5, n = 8): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const theta = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(theta), cy + r * Math.sin(theta)] as [number, number];
  });
}

vi.mock('../../drawing/projectViewFromSource', () => ({
  projectViewFromSource: vi.fn().mockResolvedValue({
    projection: {
      visibleEdges: [{ id: 'proj-e0', kind: 'outline', points: [[0,0],[50,0],[50,30],[0,30],[0,0]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
    },
    inputFingerprint: 'mock-fp-abc',
  }),
}));

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('AddBaseViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends a base view with correct fields and defined projection', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
      showHidden: true,
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(1);
    const view = sheet.views[0]!;
    expect(view.kind).toBe('base');
    if (view.kind !== 'base') return;
    expect(view.orientation).toBe('front');
    expect(view.positionMm).toEqual({ x: 50, y: 60 });
    expect(view.scale).toEqual({ numerator: 1, denominator: 1 });
    expect(view.showHidden).toBe(true);
    expect(view.projection).toBeDefined();
    expect(view.inputFingerprint).toBeDefined();
  });

  it('showHidden defaults to true when not provided', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      orientation: 'top',
      scale: { numerator: 1, denominator: 2 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.showHidden).toBe(true);
  });

  it('revert removes the added view', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      orientation: 'right',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views).toHaveLength(0);
  });

  it('apply stores projection and inputFingerprint from projectViewFromSource', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toBeDefined();
    expect(view.projection?.visibleEdges).toHaveLength(1);
    expect(view.inputFingerprint).toBe('mock-fp-abc');
  });

  it('revert removes the view even when projection was stored', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'top',
      scale: { numerator: 1, denominator: 2 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views).toHaveLength(0);
  });
});

// ─── Slice 3: auto-place center-marks on AddBaseViewCommand ────────────────────

describe('AddBaseViewCommand — center-mark auto-placement', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
    // Projection with ONE arc edge (circle r=5mm) + ONE straight edge
    vi.mocked(projectViewFromSource).mockResolvedValue({
      projection: {
        visibleEdges: [
          { id: 'arc-edge-1', kind: 'outline', points: arcPoints(10, 10, 5, 8), sourceFaceIds: [] },
          { id: 'straight-edge-1', kind: 'outline', points: [[0,0],[50,0],[50,30],[0,30],[0,0]], sourceFaceIds: [] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'mock-fp-arc',
    });
  });

  it('apply auto-adds exactly one center-mark annotation for the arc edge', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    const centerMarks = sheet.annotations.filter(a => a.kind === 'center-mark');
    expect(centerMarks).toHaveLength(1);
    expect(centerMarks[0]!.kind).toBe('center-mark');
    expect(centerMarks[0]!.edgeId).toBe('arc-edge-1');
    // View was also added
    expect(sheet.views).toHaveLength(1);
  });

  it('center-mark id is deterministic: cm-<viewId>-<edgeId>', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    const view = sheet.views[0]!;
    const cm = sheet.annotations.find(a => a.kind === 'center-mark');
    expect(cm).toBeDefined();
    expect(cm!.id).toBe(`cm-${view.id}-arc-edge-1`);
    expect(cm!.viewId).toBe(view.id);
  });

  it('no center-marks when projection has no arc edges', async () => {
    vi.mocked(projectViewFromSource).mockResolvedValueOnce({
      projection: {
        visibleEdges: [
          { id: 'straight-1', kind: 'outline', points: [[0,0],[50,0],[50,30],[0,30],[0,0]], sourceFaceIds: [] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'mock-fp-noarc',
    });
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.annotations.filter(a => a.kind === 'center-mark')).toHaveLength(0);
  });

  it('revert also removes the center-mark annotations', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.annotations.filter(a => a.kind === 'center-mark')).toHaveLength(0);
    expect(sheet.views).toHaveLength(0);
  });
});
