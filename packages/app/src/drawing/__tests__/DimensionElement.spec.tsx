// packages/app/src/drawing/__tests__/DimensionElement.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DimensionElement } from '../DimensionElement';
import type { DrawingDimension, DrawingView, ProjectedGeometry } from '@zilventor/shared';

// Minimal view + projection fixture for resolving PointRef → mm coords
const mockProj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 'e2', kind: 'outline', points: [[0, 50], [0, 100]] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
});

const mockView = (): DrawingView => ({
  id: 'v1',
  kind: 'base',
  positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: mockProj(),
} as DrawingView);

describe('DimensionElement — linear-h', () => {
  const dim: DrawingDimension = {
    id: 'd1',
    kind: 'linear-h',
    viewId: 'v1',
    from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
    to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    offsetMm: 15,
  };

  it('renders 2 extension lines + 1 dimension line + text with the measured value', () => {
    render(<svg><DimensionElement dim={dim} view={mockView()} /></svg>);
    const lines = document.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(3);  // 2 ext + 1 dim
    const text = document.querySelector('[data-dim-text]');
    expect(text?.textContent).toBe('100');
  });

  it('renders dim text data-dim-id attribute', () => {
    render(<svg><DimensionElement dim={dim} view={mockView()} /></svg>);
    expect(document.querySelector('[data-dim-id="d1"]')).not.toBeNull();
  });
});

describe('DimensionElement — radial', () => {
  const dim: DrawingDimension = {
    id: 'd2',
    kind: 'radial',
    viewId: 'v1',
    edgeId: 'e2',
    offsetMm: 10,
    angleDeg: 45,
  };

  it('renders a leader line + text with R prefix', () => {
    render(<svg><DimensionElement dim={dim} view={mockView()} /></svg>);
    const text = document.querySelector('[data-dim-text]');
    expect(text?.textContent).toMatch(/^R/);
  });
});

// ---------------------------------------------------------------------------
// Mock useAppStore for parametric text resolution tests
// ---------------------------------------------------------------------------

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(),
  },
}));

import { useAppStore } from '../../store/useAppStore';

// ---------------------------------------------------------------------------
// HS-TEXT tests — parametric text resolution cascade
// ---------------------------------------------------------------------------

describe('DimensionElement — F4 parametric text resolution', () => {
  const baseView = mockView();

  // Dim with textOverride set
  const dimWithOverride: DrawingDimension = {
    id: 'd-override',
    kind: 'linear-h',
    viewId: 'v1',
    from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
    to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    offsetMm: 15,
    textOverride: 'WIDTH ±0.5',
  };

  // Dim with sourceParameterName set
  const dimWithParam: DrawingDimension = {
    id: 'd-param',
    kind: 'linear-h',
    viewId: 'v1',
    from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
    to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    offsetMm: 15,
    sourceParameterName: 'width',
  };

  // Dim with orphan (missing) sourceParameterName
  const dimOrphan: DrawingDimension = {
    id: 'd-orphan',
    kind: 'linear-h',
    viewId: 'v1',
    from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
    to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    offsetMm: 15,
    sourceParameterName: 'deleted_param',
  };

  it('HS-TEXT-1: renders textOverride verbatim when set', () => {
    (useAppStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ activePart: null });
    render(<svg><DimensionElement dim={dimWithOverride} view={baseView} /></svg>);
    const text = document.querySelector('[data-dim-text]');
    expect(text?.textContent).toBe('WIDTH ±0.5');
  });

  it('HS-TEXT-2: renders parameter value when sourceParameterName matches active part', () => {
    (useAppStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      activePart: {
        parameters: {
          width: { name: 'width', expression: '50', value: 50, unit: 'mm' },
        },
      },
    });
    render(<svg><DimensionElement dim={dimWithParam} view={baseView} /></svg>);
    const text = document.querySelector('[data-dim-text]');
    expect(text?.textContent).toBe('50');
  });

  it('HS-TEXT-3: renders updated parameter value after parameter changes to 70', () => {
    (useAppStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      activePart: {
        parameters: {
          width: { name: 'width', expression: '70', value: 70, unit: 'mm' },
        },
      },
    });
    render(<svg><DimensionElement dim={dimWithParam} view={baseView} /></svg>);
    const text = document.querySelector('[data-dim-text]');
    expect(text?.textContent).toBe('70');
  });

  it('HS-TEXT-4: falls back to geometric distance when sourceParameterName is absent from activePart', () => {
    (useAppStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      activePart: {
        parameters: {
          // 'deleted_param' is NOT present
          width: { name: 'width', expression: '50', value: 50, unit: 'mm' },
        },
      },
    });
    render(<svg><DimensionElement dim={dimOrphan} view={baseView} /></svg>);
    const text = document.querySelector('[data-dim-text]');
    // Geometric fallback: edge e1 runs from [0,0] to [100,0]; measuredVal = |100-0| = 100
    expect(text?.textContent).toBe('100');
  });
});
