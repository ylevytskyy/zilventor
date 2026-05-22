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
