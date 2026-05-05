// packages/app/src/drawing/__tests__/ViewElement.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ViewElement } from '../ViewElement';
import type { DrawingView, ProjectedGeometry } from '@zilventor/shared';

const proj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 've1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 've2', kind: 'feature', points: [[0, 10], [100, 10]] },
  ],
  hiddenEdges: [
    { id: 'he1', kind: 'outline', points: [[0, 20], [100, 20]] },
  ],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 20 },
});

const view = (): DrawingView => ({
  id: 'v1',
  kind: 'base',
  positionMm: { x: 50, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: true,
  projection: proj(),
  inputFingerprint: 'fp1',
} as DrawingView);

describe('ViewElement', () => {
  it('renders 2 visible polylines and 1 hidden polyline', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const polylines = document.querySelectorAll('polyline');
    expect(polylines).toHaveLength(3);
  });

  it('visible polylines have stroke-width 0.35', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const visible = document.querySelector('[data-edge-id="ve1"]');
    expect(visible?.getAttribute('stroke-width')).toBe('0.35');
  });

  it('hidden polyline has stroke-dasharray "2 1" and stroke-width 0.18', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const hidden = document.querySelector('[data-edge-id="he1"]');
    expect(hidden?.getAttribute('stroke-dasharray')).toBe('2 1');
    expect(hidden?.getAttribute('stroke-width')).toBe('0.18');
  });

  it('no stale marker when isStale=false', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    expect(document.querySelector('[data-stale-marker]')).toBeNull();
  });

  it('renders stale marker when isStale=true', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={true} onRegenerate={vi.fn()} />
      </svg>
    );
    expect(document.querySelector('[data-stale-marker]')).not.toBeNull();
  });

  it('clicking stale marker calls onRegenerate with the view id', () => {
    const onRegen = vi.fn();
    render(
      <svg>
        <ViewElement view={view()} isStale={true} onRegenerate={onRegen} />
      </svg>
    );
    const marker = document.querySelector('[data-stale-marker]') as SVGElement;
    fireEvent.click(marker);
    expect(onRegen).toHaveBeenCalledWith('v1');
  });
});
