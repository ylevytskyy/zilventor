import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

const seedDrawing = (): DrawingDocument => ({
  id: 'dw1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 'sh1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 'sh1',
});

describe('DrawingTab — drawing active doc', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
  });

  it('renders 5 ribbon panels when a drawing document is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.getByText('Sheet')).toBeInTheDocument();
    expect(screen.getByText('Place Views')).toBeInTheDocument();
    expect(screen.getByText('Dimension')).toBeInTheDocument();
    expect(screen.getByText('Annotate')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('renders exactly 2 Sheet buttons, 3 Place Views buttons, 5 Dimension buttons, 4 Annotate buttons, 3 Export buttons', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    // Sheet panel: New Sheet + Sheet… (disabled follow-up)
    expect(screen.getByRole('button', { name: /new sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sheet…$/i })).toBeInTheDocument();
    // Place Views panel
    expect(screen.getByRole('button', { name: /base view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /projected view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iso view/i })).toBeInTheDocument();
    // Dimension panel
    expect(screen.getByRole('button', { name: /linear \(h\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /linear \(v\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^aligned$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^radial$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^diametric$/i })).toBeInTheDocument();
    // Annotate panel
    expect(screen.getByRole('button', { name: /centerline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /center mark/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leader text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /balloon/i })).toBeInTheDocument();
    // Export panel
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export svg/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export png/i })).toBeInTheDocument();
  });

  it('clicking Linear (H) calls setMode("addLinearH")', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /linear \(h\)/i }));
    expect(useToolModeStore.getState().mode).toBe('addLinearH');
  });

  it('clicking Radial calls setMode("addRadial")', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /^radial$/i }));
    expect(useToolModeStore.getState().mode).toBe('addRadial');
  });

  it('Balloon button is disabled for a part source drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() }); // sourceKind: 'part'
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /balloon/i })).toBeDisabled();
  });

  it('Balloon button is enabled for an assembly source drawing', () => {
    const dwg: DrawingDocument = {
      ...seedDrawing(),
      source: { partPath: 'cabinets/c1.ziasm', sourceKind: 'assembly' },
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwg });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /balloon/i })).not.toBeDisabled();
  });

  it('Sheet… button is disabled with title indicating follow-up', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /^sheet…$/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/follow-up/i);
  });
});

describe('DrawingTab ribbon — Detail button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders a "Detail" button in the Place Views panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^detail$/i })).toBeInTheDocument();
  });

  it('clicking Detail button calls enterDetailMode() — mode becomes detail', () => {
    // Need a drawing with a projected view to enable the Detail button
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /^detail$/i }));
    expect(useToolModeStore.getState().mode).toBe('detail');
    expect(useToolModeStore.getState().detailState.stage).toBe('idle');
  });

  it('Detail button is disabled when no views have a projection', () => {
    // seedDrawing() has views: [] (no projection)
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^detail$/i })).toBeDisabled();
  });

  it('Detail button is enabled when at least one view has a projection', () => {
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: {
                visibleEdges: [],
                hiddenEdges: [],
                bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 },
              },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^detail$/i })).not.toBeDisabled();
  });

  it('Detail button appears after Section button in DOM order', () => {
    render(<DrawingTab />);
    const buttons = Array.from(screen.getAllByRole('button'));
    const sectionIdx = buttons.findIndex((b) => /^section$/i.test(b.textContent ?? ''));
    const detailIdx  = buttons.findIndex((b) => /^detail$/i.test(b.textContent ?? ''));
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(detailIdx).toBeGreaterThan(sectionIdx);
  });
});

describe('DrawingTab ribbon — Section button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders a "Section" button in the Place Views panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^section$/i })).toBeInTheDocument();
  });

  it('clicking Section button calls enterSectionMode() — mode becomes section and stage idle', () => {
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /^section$/i }));
    const state = useToolModeStore.getState();
    expect(state.mode).toBe('section');
    expect(state.sectionState.stage).toBe('idle');
  });
});

describe('DrawingTab — non-drawing active doc', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('renders the stub when no document is active', () => {
    render(<DrawingTab />);
    expect(screen.getByText(/drawing generation/i)).toBeInTheDocument();
    expect(screen.queryByText('Sheet')).not.toBeInTheDocument();
  });

  it('renders the stub when a part is active', () => {
    useAppStore.getState().setActiveDocument({
      kind: 'part',
      document: {
        id: 'p1', name: 'P', units: 'mm', parameters: {}, properties: {},
        featureTree: [], materials: [], hardware: [],
      },
    });
    render(<DrawingTab />);
    expect(screen.getByText(/drawing generation/i)).toBeInTheDocument();
  });
});
