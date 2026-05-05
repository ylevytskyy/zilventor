// packages/app/src/drawing/__tests__/DimensionElement.spec.tsx
import { describe, it, expect } from 'vitest';
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
