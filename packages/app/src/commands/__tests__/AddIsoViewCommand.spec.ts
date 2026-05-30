// packages/app/src/commands/__tests__/AddIsoViewCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddIsoViewCommand } from '../AddIsoViewCommand';
import type { DrawingDocument } from '@zilventor/shared';

vi.mock('../../drawing/projectViewFromSource', () => ({
  projectViewFromSource: vi.fn().mockResolvedValue({
    projection: {
      visibleEdges: [{ id: 'iso-e0', kind: 'outline', points: [[0,0],[40,0],[20,30],[0,0]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    },
    inputFingerprint: 'mock-iso-fp',
  }),
}));

import { projectViewFromSource } from '../../drawing/projectViewFromSource';

/** 8 points on a circle of radius 5mm centred at (cx,cy). */
function arcPointsIso(cx = 10, cy = 10, r = 5, n = 8): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const theta = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(theta), cy + r * Math.sin(theta)] as [number, number];
  });
}

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

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

describe('AddIsoViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends an iso view with correct corner and defaults showHidden=false', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 200, y: 200 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    expect(view.kind).toBe('iso');
    if (view.kind !== 'iso') return;
    expect(view.corner).toBe('NE');
    expect(view.showHidden).toBe(false); // engineering convention default
    expect(view.projection).toBeDefined();
  });

  it('respects explicit showHidden=true', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      corner: 'SW',
      scale: { numerator: 1, denominator: 2 },
      showHidden: true,
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'iso') return;
    expect(view.showHidden).toBe(true);
  });

  it('revert removes the iso view', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      corner: 'NW',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views).toHaveLength(0);
  });

  it('apply stores projection and inputFingerprint; calls projectViewFromSource with iso-NE orientation', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 200, y: 200 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'iso') return;
    expect(view.projection).toBeDefined();
    expect(view.inputFingerprint).toBe('mock-iso-fp');
    expect(projectViewFromSource).toHaveBeenCalledWith('iso-NE');
  });

  it('apply calls projectViewFromSource with iso-SW for corner SW', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      corner: 'SW',
      scale: { numerator: 1, denominator: 2 },
    });
    await cmd.apply();
    expect(projectViewFromSource).toHaveBeenCalledWith('iso-SW');
  });
});

// ─── Slice 4: auto-place center-marks on AddIsoViewCommand ────────────────────

type DrawingActiveIso = { kind: 'drawing'; document: DrawingDocument };

describe('AddIsoViewCommand — center-mark auto-placement', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
    vi.mocked(projectViewFromSource).mockResolvedValue({
      projection: {
        visibleEdges: [
          { id: 'iso-arc-1', kind: 'outline', points: arcPointsIso(10, 10, 5, 8), sourceFaceIds: [] },
          { id: 'iso-straight-1', kind: 'outline', points: [[0,0],[40,0],[20,30],[0,0]], sourceFaceIds: [] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
      },
      inputFingerprint: 'mock-iso-fp-arc',
    });
  });

  it('apply auto-adds exactly one center-mark annotation for the arc edge', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 200, y: 200 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActiveIso).document;
    const sheet = doc.sheets[0]!;
    const centerMarks = sheet.annotations.filter(a => a.kind === 'center-mark');
    expect(centerMarks).toHaveLength(1);
    expect(centerMarks[0]!.edgeId).toBe('iso-arc-1');
    expect(sheet.views).toHaveLength(1);
  });

  it('center-mark id is deterministic: cm-<viewId>-<edgeId>', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 200, y: 200 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActiveIso).document;
    const sheet = doc.sheets[0]!;
    const isoView = sheet.views[0]!;
    const cm = sheet.annotations.find(a => a.kind === 'center-mark');
    expect(cm).toBeDefined();
    expect(cm!.id).toBe(`cm-${isoView.id}-iso-arc-1`);
    expect(cm!.viewId).toBe(isoView.id);
  });

  it('revert removes the center-mark annotation', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 200, y: 200 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActiveIso).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.annotations.filter(a => a.kind === 'center-mark')).toHaveLength(0);
    expect(sheet.views).toHaveLength(0);
  });
});
