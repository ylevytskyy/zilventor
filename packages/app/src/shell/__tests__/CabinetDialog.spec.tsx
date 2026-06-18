import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    hardware: [],
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

  it('OK calls onSubmit with the current params and clears the dialog state', async () => {
    seedAsm();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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
    // handleOk is now async — wait for the promise microtask to settle before checking state
    await waitFor(() => {
      expect(useAppStore.getState().cabinetDialog).toBeNull();
    });
  });
});

describe('CabinetDialog — cabinet type selector', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('renders a Type selector offering base/wall/tall', () => {
    seedAsm();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<CabinetDialog />);
    const sel = screen.getByLabelText('Type') as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual(['base', 'wall', 'tall']);
  });

  it('selecting Wall submits cabinetType=wall with toekickHeight 0', async () => {
    seedAsm();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'wall' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ cabinetType: 'wall', toekickHeight: 0 });
  });

  it('selecting Tall submits cabinetType=tall with a height preset ≥2000', async () => {
    seedAsm();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'tall' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0] as { cabinetType?: string; height: number };
    expect(submitted.cabinetType).toBe('tall');
    expect(submitted.height).toBeGreaterThanOrEqual(2000);
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

describe('CabinetDialog — async onSubmit error handling', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('onSubmit rejection keeps dialog open and shows an error alert', async () => {
    seedAsm();
    const onSubmit = vi.fn().mockRejectedValue(new Error('OPFS write failed'));
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<CabinetDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    // Dialog must remain open (cabinetDialog store slot not cleared)
    await waitFor(() => {
      expect(useAppStore.getState().cabinetDialog).not.toBeNull();
    });
    // An error alert must be visible with the rejection message
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('OPFS write failed');
  });

  it('onSubmit success closes the dialog', async () => {
    seedAsm();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<CabinetDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => {
      expect(useAppStore.getState().cabinetDialog).toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
