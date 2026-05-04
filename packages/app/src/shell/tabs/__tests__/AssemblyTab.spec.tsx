import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssemblyTab } from '../AssemblyTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

describe('AssemblyTab', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().selectComponent(null);
    useAppStore.getState().resetPlaceComponentDialog();
    useAppStore.getState().resetEditComponentDialog();
  });

  it('Place button opens the place dialog', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    fireEvent.click(screen.getByRole('button', { name: /^place$/i }));
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(true);
  });

  it('Edit button is disabled until a component is selected', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const { rerender } = render(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled();
    useAppStore.getState().selectComponent('C1');
    rerender(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^edit$/i })).not.toBeDisabled();
  });
});

describe('AssemblyTab Constraint panel', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().selectComponent(null);
    useAppStore.getState().selectConstraint(null);
    useAppStore.getState().resetPlaceConstraintDialog();
    useAppStore.getState().resetEditConstraintDialog();
  });

  it('renders all 4 mode buttons (Mate / Flush / Angle / Insert)', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^mate$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^flush$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^angle$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^insert$/i })).toBeInTheDocument();
  });

  it('Mate button opens placeConstraintDialog with mode=mate', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    fireEvent.click(screen.getByRole('button', { name: /^mate$/i }));
    expect(useAppStore.getState().placeConstraintDialogOpen).toBe(true);
    expect(useAppStore.getState().placeConstraintMode).toBe('mate');
  });
});

describe('AssemblyTab BOM panel', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().selectComponent(null);
  });

  it('renders a BOM panel with BOM and Renumber buttons', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    expect(screen.getByLabelText(/^BOM panel$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^BOM$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Renumber$/i })).toBeInTheDocument();
  });

  it('BOM button sets bomTabActive=true', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.setState({ bomTabActive: false } as any);
    render(<AssemblyTab />);
    fireEvent.click(screen.getByRole('button', { name: /^BOM$/i }));
    expect(useAppStore.getState().bomTabActive).toBe(true);
  });

  it('Renumber button assigns 1..N item numbers using provided partInfo', async () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'parts/zelda.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/alpha.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const partInfo = new Map([
      ['parts/alpha.zipt', { name: 'alpha' }],
      ['parts/zelda.zipt', { name: 'zelda' }],
    ]);
    render(<AssemblyTab partInfo={partInfo} />);
    fireEvent.click(screen.getByRole('button', { name: /^Renumber$/i }));
    await Promise.resolve();
    await Promise.resolve();
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map['parts/alpha.zipt::none']).toBe(1);
    expect(map['parts/zelda.zipt::none']).toBe(2);
  });
});
