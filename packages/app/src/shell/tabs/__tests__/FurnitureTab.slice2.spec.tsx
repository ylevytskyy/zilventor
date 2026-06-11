import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

const seedAsm: AssemblyDocument = {
  id: 'asm-1', name: 'Test', units: 'mm', parameters: {}, properties: {},
  components: [],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

function setActiveAssembly(): void {
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

describe('FurnitureTab — slice-2 ribbon buttons', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDoorDialog(null);
    useAppStore.getState().setShelfPinDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Add Door and Система-32 buttons', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: 'Add Door' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Система-32' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Система-32 (pick)' })).toBeTruthy();
  });

  it('clicking Система-32 (auto) opens the shelf-pin dialog in auto mode', () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Система-32' }));
    expect(useAppStore.getState().shelfPinDialog?.mode).toBe('auto');
  });
});
