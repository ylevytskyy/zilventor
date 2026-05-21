// packages/app/src/drawing/__tests__/HalfSectionSidePreview.spec.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { HalfSectionSidePreview } from '../HalfSectionSidePreview';

// Wrap in <svg> because the component now renders as SVG <g> (sheet-space mm overlay)
function renderInSvg(props: React.ComponentProps<typeof HalfSectionSidePreview>) {
  return render(
    <svg>
      <HalfSectionSidePreview {...props} />
    </svg>,
  );
}

describe('HalfSectionSidePreview (HS-UI-1)', () => {
  afterEach(cleanup);
  const defaultProps = {
    sectionLine: { p0: { x: 50, y: 100 }, p1: { x: 50, y: 200 } },
    pendingCutSide: 1 as -1 | 1,
    zoom: 1,
    dropAt: { x: 200, y: 150 },
    onSideHover: vi.fn(),
    onCommit: vi.fn(),
  };
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    const { container } = renderInSvg(defaultProps);
    expect(container.firstChild).not.toBeNull();
  });

  it('HS-UI-1a: hover on right-half polygon calls onSideHover(1)', () => {
    const onSideHover = vi.fn();
    const { getByTestId } = renderInSvg({ ...defaultProps, onSideHover });
    fireEvent.mouseEnter(getByTestId('half-side-1'));
    expect(onSideHover).toHaveBeenCalledWith(1);
  });

  it('HS-UI-1b: hover on left-half polygon calls onSideHover(-1)', () => {
    const onSideHover = vi.fn();
    const { getByTestId } = renderInSvg({ ...defaultProps, onSideHover });
    fireEvent.mouseEnter(getByTestId('half-side--1'));
    expect(onSideHover).toHaveBeenCalledWith(-1);
  });

  it('HS-UI-1c: click on either half calls onCommit with that side', () => {
    const onCommit = vi.fn();
    const { getByTestId } = renderInSvg({ ...defaultProps, onCommit });
    fireEvent.click(getByTestId('half-side-1'));
    expect(onCommit).toHaveBeenCalledWith(1);
    onCommit.mockClear();
    fireEvent.click(getByTestId('half-side--1'));
    expect(onCommit).toHaveBeenCalledWith(-1);
  });

  it('HS-UI-1d: fill element has min width ≥ 4 (zoom-scaled)', () => {
    const { getByTestId } = renderInSvg({ ...defaultProps, pendingCutSide: 1, zoom: 1 });
    const fillEl = getByTestId('half-fill');
    const width = parseFloat(fillEl.getAttribute('width') ?? '0');
    expect(width).toBeGreaterThanOrEqual(4);
  });

  it('HS-UI-1e: ArrowRight fires onSideHover(1); ArrowLeft fires onSideHover(-1)', () => {
    const onSideHover = vi.fn();
    renderInSvg({ ...defaultProps, onSideHover });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSideHover).toHaveBeenCalledWith(1);
    onSideHover.mockClear();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onSideHover).toHaveBeenCalledWith(-1);
  });
});
