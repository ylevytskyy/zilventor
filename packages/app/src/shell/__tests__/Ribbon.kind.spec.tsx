import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Ribbon from '../Ribbon';
import { useAppStore } from '../../store/useAppStore';
import type { PartDocument, AssemblyDocument, DrawingDocument } from '@zilventor/shared';

const makePart = (): PartDocument =>
  ({ id: 'p1', name: 'Part', featureTree: [], parameters: {}, materials: [] } as unknown as PartDocument);
const makeAssembly = (): AssemblyDocument =>
  ({ id: 'a1', name: 'Asm', components: [], constraints: [], groundedComponentPaths: [],
     materials: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {} } as unknown as AssemblyDocument);
const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'p.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => useAppStore.getState().setActiveDocument(null));

describe('Ribbon tab sets by document kind', () => {
  it('part mode shows Model tab and Assembly tab (Explode button lives there)', () => {
    useAppStore.getState().setActiveDocument({ kind: 'part', document: makePart() });
    render(<Ribbon />);
    expect(screen.getByRole('tab', { name: 'Model' })).toBeTruthy();
    // Assembly tab must be visible in part mode so "Explode into Assembly" is reachable.
    expect(screen.getByRole('tab', { name: 'Assembly' })).toBeTruthy();
  });

  it('assembly mode shows Assembly tab, not Model', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAssembly() });
    render(<Ribbon />);
    expect(screen.getByRole('tab', { name: 'Assembly' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Model' })).toBeNull();
  });

  it('drawing mode shows only File, Drawing, View tabs', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    render(<Ribbon />);
    expect(screen.getByRole('tab', { name: 'File' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Drawing' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'View' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Model' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Assembly' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Sketch' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Furniture' })).toBeNull();
  });

  it('drawing mode default tab is Drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    render(<Ribbon />);
    const drawingTab = screen.getByRole('tab', { name: 'Drawing' });
    expect(drawingTab.getAttribute('aria-selected')).toBe('true');
  });
});
