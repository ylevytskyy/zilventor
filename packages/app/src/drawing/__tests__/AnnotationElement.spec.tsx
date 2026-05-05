// packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AnnotationElement } from '../AnnotationElement';
import type { DrawingAnnotation, DrawingView, ProjectedGeometry } from '@zilventor/shared';

const mockProj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 'e2', kind: 'outline', points: [[50, 0], [50, 80]] },
    { id: 'circ1', kind: 'feature', points: [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
});

const mockView = (): DrawingView => ({
  id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front',
  showHidden: false, projection: mockProj(),
} as DrawingView);

describe('AnnotationElement — balloon', () => {
  const ann: DrawingAnnotation = {
    id: 'a1',
    kind: 'balloon',
    viewId: 'v1',
    targetMm: { x: 30, y: 30 },
    textPosMm: { x: 60, y: 20 },
    itemNumber: 3,
  };

  it('renders a circle element', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('circle')).not.toBeNull();
  });

  it('renders the item number inside the balloon', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    const text = document.querySelector('[data-ann-text]');
    expect(text?.textContent).toBe('3');
  });

  it('renders a leader polyline from targetMm to textPosMm', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('polyline')).not.toBeNull();
  });
});

describe('AnnotationElement — centerline', () => {
  const ann: DrawingAnnotation = {
    id: 'a2', kind: 'centerline', viewId: 'v1',
    edgeIdA: 'e1', edgeIdB: 'e2',
  };

  it('renders cross-pattern paths for centerline', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    const paths = document.querySelectorAll('line,path');
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe('AnnotationElement — center-mark', () => {
  const ann: DrawingAnnotation = {
    id: 'a3', kind: 'center-mark', viewId: 'v1', edgeId: 'circ1',
  };

  it('renders center mark cross lines', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
  });
});

describe('AnnotationElement — leader', () => {
  const ann: DrawingAnnotation = {
    id: 'a4', kind: 'leader', viewId: 'v1',
    targetMm: { x: 20, y: 20 }, textPosMm: { x: 60, y: 10 }, text: 'Sharp edge',
  };

  it('renders text content for leader', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('[data-ann-text]')?.textContent).toBe('Sharp edge');
  });
});
