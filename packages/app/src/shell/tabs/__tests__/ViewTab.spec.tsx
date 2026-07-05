import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as THREE from 'three';
import ViewTab from '../ViewTab';
import { useAppStore } from '../../../store/useAppStore';

describe('ViewTab Fit and Home buttons', () => {
  beforeEach(() => {
    cleanup();
  });

  it('clicking Fit calls SceneManager.frameToModel with no direction arg', () => {
    const frameToModel = vi.fn();
    useAppStore.setState({ viewport: { getSceneManager: () => ({ frameToModel }) } } as any);
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Fit/i });
    fireEvent.click(btn);
    expect(frameToModel).toHaveBeenCalledTimes(1);
    expect(frameToModel).toHaveBeenCalledWith();
  });

  it('clicking Home calls SceneManager.frameToModel with the isometric (1,1,1) direction', () => {
    const frameToModel = vi.fn();
    useAppStore.setState({ viewport: { getSceneManager: () => ({ frameToModel }) } } as any);
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Home/i });
    fireEvent.click(btn);
    expect(frameToModel).toHaveBeenCalledTimes(1);
    const arg = frameToModel.mock.calls[0]![0] as THREE.Vector3;
    expect(arg).toBeInstanceOf(THREE.Vector3);
    const normalized = arg.clone().normalize();
    const expected = new THREE.Vector3(1, 1, 1).normalize();
    expect(normalized.x).toBeCloseTo(expected.x, 6);
    expect(normalized.y).toBeCloseTo(expected.y, 6);
    expect(normalized.z).toBeCloseTo(expected.z, 6);
  });
});

describe('ViewTab Show component colors toggle', () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({ showComponentColors: false } as any);
  });

  it('renders the Show component colors button initially in the off state', () => {
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Show component colors/i });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent ?? '').not.toMatch(/^✓/);
    expect(btn.textContent ?? '').toMatch(/^Show component colors/);
  });

  it('clicking the button flips showComponentColors and reflects the on state', () => {
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Show component colors/i });
    fireEvent.click(btn);
    expect(useAppStore.getState().showComponentColors).toBe(true);
    const after = screen.getByRole('button', { name: /Show component colors/i });
    expect(after.textContent ?? '').toMatch(/^✓ /);
  });
});

describe('ViewTab Show edge bands toggle', () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({ showEdgeBands: true } as any);
  });

  it('renders the Show edge bands button initially in the on state (default true)', () => {
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Show edge bands/i });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent ?? '').toMatch(/^✓ /);
  });

  it('clicking the button flips showEdgeBands and reflects the off state', () => {
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Show edge bands/i });
    fireEvent.click(btn);
    expect(useAppStore.getState().showEdgeBands).toBe(false);
    const after = screen.getByRole('button', { name: /Show edge bands/i });
    expect(after.textContent ?? '').not.toMatch(/^✓/);
  });
});
