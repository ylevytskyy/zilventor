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

describe('StatusBar assembly DOF segment', () => {
  const makeAsm = (constraints: any[]) => ({
    id: 'A1', name: 'asm', units: 'mm' as const, parameters: {},
    components: [], constraints, groundedComponentIds: [],
  });

  beforeEach(() => {
    useAppStore.getState().setSketchDof(null);
    useAppStore.getState().setActiveDocument(null);
  });

  it('shows "Assembly: fully constrained" (green) when fully-constrained', () => {
    useAppStore.setState({
      activeAssembly: makeAsm([{ id: 'k1' }]),
      solverDiagnostics: { dofCount: 0, status: 'fully-constrained', perConstraint: new Map() },
    });
    render(<StatusBar />);
    expect(screen.getByText(/Assembly: fully constrained/i)).toBeInTheDocument();
  });

  it('shows "Assembly: N DOF" (yellow) when underconstrained', () => {
    useAppStore.setState({
      activeAssembly: makeAsm([{ id: 'k1' }]),
      solverDiagnostics: { dofCount: 4, status: 'underconstrained', perConstraint: new Map() },
    });
    render(<StatusBar />);
    expect(screen.getByText(/Assembly: 4 DOF/)).toBeInTheDocument();
  });

  it('shows "Assembly: over-constrained" (red) when over-constrained', () => {
    useAppStore.setState({
      activeAssembly: makeAsm([{ id: 'k1' }]),
      solverDiagnostics: { dofCount: 0, status: 'over-constrained', perConstraint: new Map() },
    });
    render(<StatusBar />);
    expect(screen.getByText(/Assembly: over-constrained/i)).toBeInTheDocument();
  });

  it('shows "Assembly: solver did not converge" (red) when did-not-converge', () => {
    useAppStore.setState({
      activeAssembly: makeAsm([{ id: 'k1' }]),
      solverDiagnostics: { dofCount: 0, status: 'did-not-converge', perConstraint: new Map() },
    });
    render(<StatusBar />);
    expect(screen.getByText(/Assembly: solver did not converge/i)).toBeInTheDocument();
  });

  it('hides assembly segment when no constraints exist', () => {
    useAppStore.setState({
      activeAssembly: makeAsm([]),
      solverDiagnostics: { dofCount: 0, status: 'fully-constrained', perConstraint: new Map() },
    });
    render(<StatusBar />);
    expect(screen.queryByText(/Assembly:/)).not.toBeInTheDocument();
  });
});
