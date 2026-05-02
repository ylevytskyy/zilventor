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
    id: 'A1', name: 'asm', units: 'mm' as const, parameters: {}, properties: {},
    components: [], constraints, groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
    materials: [],
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

describe('StatusBar sub-asm leaf count + diagnostic badge (4d T27)', () => {
  beforeEach(() => {
    useAppStore.getState().setSketchDof(null);
    useAppStore.setState({
      activeDocument: null,
      activeAssembly: null,
      subAssemblyDocs: {},
      subAssemblyDiagnostics: [],
    } as any);
  });

  it('shows "N components in M sub-assemblies" with seeded sub-asm tree', () => {
    const childDoc = {
      id: 'CH', name: 'drawer', units: 'mm', parameters: {},
      components: [
        { id: 'P1', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'P2', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
    };
    const otherSubDoc = {
      id: 'CH2', name: 'box', units: 'mm', parameters: {},
      components: [
        { id: 'X1', partPath: 'parts/b.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
    };
    const top: any = {
      id: 'A1', name: 'cab', units: 'mm', parameters: {},
      components: [
        { id: 'SUB1', partPath: 'sub/drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'SUB2', partPath: 'sub/box.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C1', partPath: 'parts/leg.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
    };
    useAppStore.setState({
      activeAssembly: top,
      activeDocument: { kind: 'assembly', document: top },
      subAssemblyDocs: { 'sub/drawer.ziasm': childDoc, 'sub/box.ziasm': otherSubDoc },
      subAssemblyDiagnostics: [],
    } as any);
    render(<StatusBar />);
    // Top has 1 zipt leaf + drawer (2 leaves) + box (1 leaf) = 4 leaves; 2 sub-assemblies
    expect(screen.getByText(/4 components in 2 sub-assemblies/)).toBeInTheDocument();
  });

  it('shows a diagnostic badge with aria-label when diagnostics are present', () => {
    const top: any = {
      id: 'A1', name: 'cab', units: 'mm', parameters: {},
      components: [],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
    };
    useAppStore.setState({
      activeAssembly: top,
      activeDocument: { kind: 'assembly', document: top },
      subAssemblyDocs: {},
      subAssemblyDiagnostics: [{ partPath: 'a.ziasm', kind: 'cycle', message: 'cycle' }],
    } as any);
    render(<StatusBar />);
    expect(screen.getByLabelText(/1 diagnostic/i)).toBeInTheDocument();
  });

  it('hides the sub-asm summary when no assembly is active', () => {
    render(<StatusBar />);
    expect(screen.queryByText(/components in/i)).toBeNull();
  });
});
