// packages/app/src/drawing/__tests__/TitleBlock.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TitleBlock } from '../TitleBlock';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

const sheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [],
  dimensions: [],
  annotations: [],
  titleBlock: {},
  dimensionGroups: [],
});

const drawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [sheet()],
  activeSheetId: 's1',
});

const source = (): PartDocument => ({
  id: 'p1',
  name: 'Cabinet',
  parameters: [],
  features: [],
  materials: [],
  properties: {},
} as unknown as PartDocument);

describe('TitleBlock', () => {
  it('renders drawing name field', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    expect(screen.getByText('Cabinet — Drawing')).toBeInTheDocument();
  });

  it('renders part name field', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    expect(screen.getByText('Cabinet')).toBeInTheDocument();
  });

  it('renders sheet n/N as "1 / 1"', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('override drawingName wins over auto-derived name', () => {
    const s = { ...sheet(), titleBlock: { drawingName: 'MY OVERRIDE' } };
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={s} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    expect(screen.getByText('MY OVERRIDE')).toBeInTheDocument();
  });

  it('renders default scale 1:1', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    expect(screen.getByText('1:1')).toBeInTheDocument();
  });
});

// --- SLICE 2: Projection symbol (live-vs-export parity) ---
describe('TitleBlock — projection symbol', () => {
  it('renders a <g data-role="projection-symbol"> element', () => {
    const { container } = render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    const sym = container.querySelector('[data-role="projection-symbol"]');
    expect(sym).not.toBeNull();
  });

  it('projection symbol contains a <circle> element', () => {
    const { container } = render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    const sym = container.querySelector('[data-role="projection-symbol"]')!;
    expect(sym.querySelector('circle')).not.toBeNull();
  });

  it('projection symbol contains a <path> (trapezoid)', () => {
    const { container } = render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    const sym = container.querySelector('[data-role="projection-symbol"]')!;
    expect(sym.querySelector('path')).not.toBeNull();
  });

  it('first-angle: circle cx is to the RIGHT of trapezoid (circle cx > trapezoid right edge x)', () => {
    const { container } = render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} createdAt="2026-01-01" />
      </svg>
    );
    const sym = container.querySelector('[data-role="projection-symbol"]')!;
    const circle = sym.querySelector('circle')!;
    const path = sym.querySelector('path')!;
    const circleCx = parseFloat(circle.getAttribute('cx')!);
    // Extract the maximum x from the path d attribute (trapezoid right edge)
    const d = path.getAttribute('d')!;
    const xValues = [...d.matchAll(/(?:M|L)\s*([\d.]+)\s/g)].map((m) => parseFloat(m[1]));
    const maxTrapX = Math.max(...xValues);
    expect(circleCx).toBeGreaterThan(maxTrapX);
  });
});
