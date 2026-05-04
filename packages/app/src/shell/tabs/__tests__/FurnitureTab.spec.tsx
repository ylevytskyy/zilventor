import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import type { AssemblyDocument } from '@zilventor/shared';

const seedAsm: AssemblyDocument = {
  id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
  components: [],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

function seedAssemblyMode() {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: seedAsm },
    activeAssembly: seedAsm,
    activePart: null,
    bomTabActive: false,
    cutListTabActive: false,
    subAssemblyDocs: {},
    panelDialog: null,
  } as any);
}

describe('FurnitureTab', () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activePart: null,
      activeAssembly: null,
      activeDocument: null,
      panelDialog: null,
    } as Partial<ReturnType<typeof useAppStore.getState>>);
  });

  it('renders the Create panel with a Panel button', () => {
    render(<FurnitureTab />);
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Panel/i })).toBeInTheDocument();
  });

  it('clicking Panel dispatches OpenPanelDialogCommand (panelDialog slot populated)', async () => {
    useAppStore.getState().setActivePart(newPart('P1'));
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: /Panel/i }));
    await waitFor(() => {
      expect(useAppStore.getState().panelDialog).not.toBeNull();
    });
    expect(useAppStore.getState().panelDialog!.mode).toBe('part');
  });

  it('Panel button is disabled when no part and no assembly is active', () => {
    render(<FurnitureTab />);
    const btn = screen.getByRole('button', { name: /Panel/i });
    expect(btn).toBeDisabled();
  });
});

describe('FurnitureTab Cut List panel (5d T21)', () => {
  beforeEach(() => {
    cleanup();
    seedAssemblyMode();
  });

  it('renders the Cut List ribbon panel with three buttons', () => {
    render(<FurnitureTab />);
    expect(screen.getByLabelText('Cut List panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cut List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renumber' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('clicking Cut List dispatches OpenCutListTabCommand', async () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Cut List' }));
    await waitFor(() => expect(useAppStore.getState().cutListTabActive).toBe(true));
  });

  it('clicking Renumber dispatches RenumberCutListCommand', async () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Renumber' }));
    await waitFor(() => expect(useAppStore.getState().activeAssembly!.cutListItemNumbers).toEqual({}));
  });
});
