// packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { RegenerateViewCommand } from '../RegenerateViewCommand';
import type { DrawingDocument, BaseView, ProjectedGeometry } from '@zilventor/shared';

const OLD_PROJECTION: ProjectedGeometry = {
  visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]], sourceFaceIds: [] }],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
};

const NEW_PROJECTION: ProjectedGeometry = {
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [120, 0]], sourceFaceIds: [] },
    { id: 'e2', kind: 'outline', points: [[0, 0], [0, 60]], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 120, maxY: 60 },
};

const VIEW_WITH_OLD: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
  projection: OLD_PROJECTION,
  inputFingerprint: 'old-fingerprint-abc',
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW_WITH_OLD], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('RegenerateViewCommand', () => {
  beforeEach(() => {
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply replaces projection and inputFingerprint on the target view', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      projection: NEW_PROJECTION,
      inputFingerprint: 'new-fingerprint-xyz',
    });
    await cmd.apply();

    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = (useAppStore.getState().activeDocument as unknown as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toEqual(NEW_PROJECTION);
    expect(view.inputFingerprint).toBe('new-fingerprint-xyz');
  });

  it('revert restores the prior projection and fingerprint', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      projection: NEW_PROJECTION,
      inputFingerprint: 'new-fingerprint-xyz',
    });
    await cmd.apply();
    await cmd.revert();

    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = (useAppStore.getState().activeDocument as unknown as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toEqual(OLD_PROJECTION);
    expect(view.inputFingerprint).toBe('old-fingerprint-abc');
  });

  it('revert with no prior projection/fingerprint (fresh view) restores undefined', async () => {
    const freshView: BaseView = {
      id: 'view-fresh', kind: 'base',
      positionMm: { x: 0, y: 0 },
      orientation: 'top',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeDrawing().sheets[0]!,
            views: [freshView],
          }],
        },
      },
    } as never);

    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1', viewId: 'view-fresh',
      projection: NEW_PROJECTION, inputFingerprint: 'fp-1',
    });
    await cmd.apply();
    await cmd.revert();

    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = (useAppStore.getState().activeDocument as unknown as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toBeUndefined();
    expect(view.inputFingerprint).toBeUndefined();
  });
});
