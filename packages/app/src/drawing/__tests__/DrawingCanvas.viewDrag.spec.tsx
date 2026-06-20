// packages/app/src/drawing/__tests__/DrawingCanvas.viewDrag.spec.tsx
// M3.4.3 — left-button view drag in idle mode dispatches MoveViewCommand on
// release, moving the dragged base view and its aligned projected views together.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';
import { createCommandBus } from '../../commands/CommandBus';

const BASE_ID = 'base-drag';
const PROJ_ID = 'proj-drag';

// jsdom getBoundingClientRect() returns a 0-size rect, so clientToSheet falls back
// to raw client coords as mm — client pixels are sheet mm in this test.
function makeDrawing() {
  return {
    id: 'drw-drag',
    name: 'Drag Drawing',
    units: 'mm' as const,
    source: { partPath: 'part.zipt', sourceKind: 'part' as const },
    properties: {},
    sheets: [{
      id: 'sheet-d',
      name: 'Sheet 1',
      size: { kind: 'iso' as const, size: 'A3' as const },
      orientation: 'landscape' as const,
      views: [
        {
          id: BASE_ID, kind: 'base' as const,
          positionMm: { x: 100, y: 100 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
        },
        {
          id: PROJ_ID, kind: 'projected' as const,
          positionMm: { x: 100, y: 250 },
          baseViewId: BASE_ID,
          direction: 'top' as const,
          scale: { numerator: 1, denominator: 1 },
          showHidden: false,
        },
      ],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-d',
  };
}

function basePos() {
  const d = useAppStore.getState().activeDrawing as never as ReturnType<typeof makeDrawing>;
  return d.sheets[0]!.views.find(v => v.id === BASE_ID)!.positionMm;
}
function projPos() {
  const d = useAppStore.getState().activeDrawing as never as ReturnType<typeof makeDrawing>;
  return d.sheets[0]!.views.find(v => v.id === PROJ_ID)!.positionMm;
}

describe('DrawingCanvas — view drag (M3.4.3)', () => {
  beforeEach(() => {
    useToolModeStore.getState().setMode('idle');
    const doc = makeDrawing();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: doc as never },
      activeDrawing: doc as never,
      bus: createCommandBus() as never,
    } as never, false);
  });

  it('dragging a base view moves it and its projected view together', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg')!;

    // mousedown inside the base view box (100..300 × 100..250), drag +30,+60.
    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseMove(svg, { clientX: 180, clientY: 210 });
    fireEvent.mouseUp(svg, { clientX: 180, clientY: 210 });

    await waitFor(() => expect(basePos()).toEqual({ x: 130, y: 160 }));
    expect(projPos()).toEqual({ x: 130, y: 310 }); // 100+30, 250+60
  });

  it('a zero-distance press (click) does not move the view', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg')!;

    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseUp(svg, { clientX: 150, clientY: 150 });

    await Promise.resolve();
    expect(basePos()).toEqual({ x: 100, y: 100 });
    expect(projPos()).toEqual({ x: 100, y: 250 });
  });
});
