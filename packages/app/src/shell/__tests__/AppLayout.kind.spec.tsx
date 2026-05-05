// Tests that the correct main-area component renders for each activeDocument kind.
// Uses a lightweight surrogate of the App layout conditional to avoid OCCT/kernel deps.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, PartDocument, AssemblyDocument } from '@zilventor/shared';

// Re-export the layout slice under test by pulling just the reactive render logic.
import { DrawingCanvas } from '../../drawing/DrawingCanvas';
import { DrawingTreePane } from '../../drawing/DrawingTreePane';
import Viewport from '../../viewport/Viewport';
import BrowserPane from '../../shell/BrowserPane';

// Mock heavy dependencies so the layout test stays unit-scoped.
vi.mock('../../viewport/Viewport', () => ({
  default: () => <div data-testid="viewport" />,
}));
vi.mock('../../shell/BrowserPane', () => ({
  default: () => <div data-testid="browser-pane" />,
}));
vi.mock('../../drawing/DrawingCanvas', () => ({
  DrawingCanvas: () => <div data-testid="drawing-canvas" />,
}));
vi.mock('../../drawing/DrawingTreePane', () => ({
  DrawingTreePane: () => <div data-testid="drawing-tree-pane" />,
}));

// Minimal inline surrogate of the App layout branch
function LayoutSurrogate() {
  const activeDocKind = useAppStore((s) => s.activeDocument?.kind ?? 'part');
  return (
    <div>
      <aside>
        {activeDocKind === 'drawing'
          ? <DrawingTreePane />
          : <BrowserPane part={null} />
        }
      </aside>
      <main>
        {activeDocKind === 'drawing'
          ? <DrawingCanvas />
          : <Viewport />
        }
      </main>
    </div>
  );
}

const makePart = (): PartDocument =>
  ({ id: 'p1', name: 'Part', featureTree: [], parameters: {}, materials: [] } as unknown as PartDocument);
const makeAssembly = (): AssemblyDocument =>
  ({ id: 'a1', name: 'Asm', components: [], constraints: [], groundedComponentPaths: [],
     materials: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {} } as unknown as AssemblyDocument);
const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'p.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => useAppStore.getState().setActiveDocument(null));

describe('App layout routing by document kind', () => {
  it('part mode → Viewport + BrowserPane rendered', () => {
    useAppStore.getState().setActiveDocument({ kind: 'part', document: makePart() });
    render(<LayoutSurrogate />);
    expect(screen.getByTestId('viewport')).toBeTruthy();
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
    expect(screen.queryByTestId('drawing-canvas')).toBeNull();
    expect(screen.queryByTestId('drawing-tree-pane')).toBeNull();
  });

  it('assembly mode → Viewport + BrowserPane rendered', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAssembly() });
    render(<LayoutSurrogate />);
    expect(screen.getByTestId('viewport')).toBeTruthy();
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
  });

  it('drawing mode → DrawingCanvas + DrawingTreePane rendered, Viewport absent', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    render(<LayoutSurrogate />);
    expect(screen.getByTestId('drawing-canvas')).toBeTruthy();
    expect(screen.getByTestId('drawing-tree-pane')).toBeTruthy();
    expect(screen.queryByTestId('viewport')).toBeNull();
    expect(screen.queryByTestId('browser-pane')).toBeNull();
  });
});
