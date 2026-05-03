import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CabinetDialog } from '../CabinetDialog';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, MaterialEntry } from '@zilventor/shared';

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };

function seedAsm(materials = [carcass, back]): void {
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Project', units: 'mm',
    parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials,
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}

describe('CabinetDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('renders nothing when cabinetDialog state is null', () => {
    seedAsm();
    const { container } = render(<CabinetDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all input fields when open', () => {
    seedAsm();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<CabinetDialog />);
    for (const label of [
      'Name', 'Width', 'Depth', 'Height',
      'Toekick height', 'Toekick setback', 'Shelf count',
      'Carcass material', 'Back material', 'Edge band material',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
  });

  it('OK calls onSubmit with the current params and clears the dialog state', () => {
    seedAsm();
    const onSubmit = vi.fn();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      name: 'Base Cabinet 1',
      width: 600, depth: 560, height: 720,
      toekickHeight: 100, toekickSetback: 50, shelfCount: 1,
      carcassMaterialId: 'm-birch-18',
      backMaterialId: 'm-hb-6',
      bandMaterialId: null,
    });
    expect(useAppStore.getState().cabinetDialog).toBeNull();
  });
});

describe('CabinetDialog — validation', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('disables OK and shows an error when width ≤ 2·Tc', () => {
    seedAsm();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '36' } });
    expect(screen.getByText(/Width must exceed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables OK when carcass material is unset', () => {
    seedAsm();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Carcass material'), { target: { value: '' } });
    expect(screen.getByText('Pick a carcass material.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not call onSubmit when OK is clicked while invalid', () => {
    seedAsm();
    const onSubmit = vi.fn();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('CabinetDialog — empty registry', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('renders an inline "No materials yet" hint when the registry is empty', () => {
    seedAsm([]);
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    expect(screen.getByText(/No materials yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });
});
