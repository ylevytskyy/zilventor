// packages/app/src/drawing/__tests__/HalfSectionSidePreview.spec.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { HalfSectionSidePreview } from '../HalfSectionSidePreview';

describe('HalfSectionSidePreview (HS-UI-1)', () => {
  afterEach(cleanup);
  const defaultProps = {
    sectionLine: { p0: { x: 50, y: 100 }, p1: { x: 50, y: 200 } },
    pendingCutSide: 1 as -1 | 1,
    zoom: 1,
    onSideHover: vi.fn(),
    onCommit: vi.fn(),
  };
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    const { container } = render(<HalfSectionSidePreview {...defaultProps} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('HS-UI-1a: hover on right-half polygon calls onSideHover(1)', () => {
    const onSideHover = vi.fn();
    const { getByTestId } = render(<HalfSectionSidePreview {...defaultProps} onSideHover={onSideHover} />);
    fireEvent.mouseEnter(getByTestId('half-side-1'));
    expect(onSideHover).toHaveBeenCalledWith(1);
  });

  it('HS-UI-1b: hover on left-half polygon calls onSideHover(-1)', () => {
    const onSideHover = vi.fn();
    const { getByTestId } = render(<HalfSectionSidePreview {...defaultProps} onSideHover={onSideHover} />);
    fireEvent.mouseEnter(getByTestId('half-side--1'));
    expect(onSideHover).toHaveBeenCalledWith(-1);
  });

  it('HS-UI-1c: click on either half calls onCommit with that side', () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(<HalfSectionSidePreview {...defaultProps} onCommit={onCommit} />);
    fireEvent.click(getByTestId('half-side-1'));
    expect(onCommit).toHaveBeenCalledWith(1);
    onCommit.mockClear();
    fireEvent.click(getByTestId('half-side--1'));
    expect(onCommit).toHaveBeenCalledWith(-1);
  });

  it('HS-UI-1d: fill element has min width ≥ 20px', () => {
    const { getByTestId } = render(<HalfSectionSidePreview {...defaultProps} pendingCutSide={1} zoom={1} />);
    const fillEl = getByTestId('half-fill');
    const style = fillEl.getAttribute('style') ?? '';
    const width = parseFloat(style.match(/width:\s*([0-9.]+)px/)?.[1] ?? '0');
    expect(width).toBeGreaterThanOrEqual(20);
  });

  it('HS-UI-1e: ArrowRight fires onSideHover(1); ArrowLeft fires onSideHover(-1)', () => {
    const onSideHover = vi.fn();
    render(<HalfSectionSidePreview {...defaultProps} onSideHover={onSideHover} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSideHover).toHaveBeenCalledWith(1);
    onSideHover.mockClear();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onSideHover).toHaveBeenCalledWith(-1);
  });
});
