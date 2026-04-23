import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../StatusBar';
import { useAppStore } from '../../store/useAppStore';

beforeEach(() => {
  useAppStore.getState().setSketchDof(null);
});

describe('StatusBar', () => {
  it('shows "Ready" by default', () => {
    render(<StatusBar message="Ready" />);
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('mm')).toBeTruthy();
  });

  it('shows a custom message', () => {
    render(<StatusBar message="Loading CAD kernel…" />);
    expect(screen.getByText(/loading cad kernel/i)).toBeTruthy();
  });

  it('shows the Modified indicator when modified', () => {
    render(<StatusBar message="Ready" modified />);
    expect(screen.getByText(/modified/i)).toBeTruthy();
  });

  it('shows selection info when provided', () => {
    render(<StatusBar message="Ready" selection="1 selected" />);
    expect(screen.getByText('1 selected')).toBeTruthy();
  });
});

describe('StatusBar DOF segment', () => {
  it('shows "Fully constrained" when state is fully', () => {
    useAppStore.getState().setSketchDof({ count: 0, state: 'fully' });
    render(<StatusBar />);
    expect(screen.getByText(/Fully constrained/)).toBeInTheDocument();
  });

  it('shows "N DOF" when under-constrained', () => {
    useAppStore.getState().setSketchDof({ count: 3, state: 'under' });
    render(<StatusBar />);
    expect(screen.getByText(/3 DOF/)).toBeInTheDocument();
  });

  it('shows "Over constrained: N" when state is over', () => {
    useAppStore.getState().setSketchDof({ count: 2, state: 'over' });
    render(<StatusBar />);
    expect(screen.getByText(/Over constrained: 2/)).toBeInTheDocument();
  });

  it('hides the DOF segment when sketchDof is null', () => {
    useAppStore.getState().setSketchDof(null);
    render(<StatusBar />);
    expect(screen.queryByText(/DOF|Fully constrained|Over constrained/)).not.toBeInTheDocument();
  });
});
