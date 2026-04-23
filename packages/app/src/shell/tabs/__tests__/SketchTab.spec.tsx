import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SketchTab from '../SketchTab';
import { useAppStore } from '../../../store/useAppStore';

beforeEach(() => {
  cleanup();
  // Reset store to a clean state before each test.
  useAppStore.getState().setSketchMode(false);
  useAppStore.getState().setActiveToolKind(null);
});

describe('SketchTab', () => {
  it('renders Select + 8 constraint buttons when sketch mode is on', () => {
    useAppStore.getState().setSketchMode(true, 'S1');
    render(<SketchTab />);
    for (const name of [
      'Select',
      'Coincident', 'Horizontal', 'Vertical',
      'Parallel', 'Perpendicular', 'Tangent', 'Equal', 'Symmetric'
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(name, 'i') })).toBeTruthy();
    }
  });

  it('clicking Horizontal sets activeToolKind to constrain-horizontal', () => {
    useAppStore.getState().setSketchMode(true, 'S1');
    render(<SketchTab />);
    fireEvent.click(screen.getByRole('button', { name: /Horizontal/ }));
    expect(useAppStore.getState().activeToolKind).toBe('constrain-horizontal');
  });
});
