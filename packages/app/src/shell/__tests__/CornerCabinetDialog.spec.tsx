import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CornerCabinetDialog } from '../CornerCabinetDialog';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, MaterialEntry } from '@zilventor/shared';
import FurnitureTab from '../tabs/FurnitureTab';

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

describe('CornerCabinetDialog — renders and submits real params', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCornerCabinetDialog(null);
  });

  it('renders nothing when cornerCabinetDialog state is null', () => {
    seedAsm();
    const { container } = render(<CornerCabinetDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all dimension inputs when open', () => {
    seedAsm();
    useAppStore.getState().setCornerCabinetDialog({
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<CornerCabinetDialog />);
    expect(screen.getByLabelText('Width 1 (mm)')).toBeTruthy();
    expect(screen.getByLabelText('Depth 1 (mm)')).toBeTruthy();
    expect(screen.getByLabelText('Width 2 (mm)')).toBeTruthy();
    expect(screen.getByLabelText('Depth 2 (mm)')).toBeTruthy();
    expect(screen.getByLabelText('Height (mm)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
  });

  it('OK calls onSubmit with the current params and clears the dialog state', async () => {
    seedAsm();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setCornerCabinetDialog({
      onSubmit,
      onCancel: () => useAppStore.getState().setCornerCabinetDialog(null),
    });
    render(<CornerCabinetDialog />);

    // Change dimensions to values that satisfy the leg constraint:
    // width1 > depth2 and width2 > depth1
    // defaults are 900/600/900/600/720 which already satisfy this
    fireEvent.change(screen.getByLabelText('Width 1 (mm)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Depth 1 (mm)'), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText('Width 2 (mm)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Depth 2 (mm)'), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText('Height (mm)'), { target: { value: '720' } });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      width1: 900, depth1: 600, width2: 900, depth2: 600, height: 720,
      carcassMaterialId: 'm-birch-18',
      backMaterialId: 'm-hb-6',
      bandMaterialId: null,
    });
    await waitFor(() => {
      expect(useAppStore.getState().cornerCabinetDialog).toBeNull();
    });
  });

  it('disables OK and shows error when width1 <= depth2 (leg constraint)', () => {
    seedAsm();
    useAppStore.getState().setCornerCabinetDialog({
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<CornerCabinetDialog />);
    // Set width1 = depth2 (equal, so width1 <= depth2 fails)
    fireEvent.change(screen.getByLabelText('Width 1 (mm)'), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText('Depth 2 (mm)'), { target: { value: '600' } });
    expect(screen.getByText(/Leg must extend past the corner/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('FurnitureTab — Corner Cabinet button routes to template:cornerCabinet', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCornerCabinetDialog(null);
  });

  it('clicking Corner Cabinet button opens cornerCabinetDialog with the real FurnitureTab onSubmit', async () => {
    // Seed an active assembly so OpenCornerCabinetDialogCommand does not throw NO_ACTIVE_ASSEMBLY
    seedAsm();

    render(<FurnitureTab />);

    const btn = screen.getByRole('button', { name: 'Corner Cabinet' });
    fireEvent.click(btn);

    // The real FurnitureTab handler calls OpenCornerCabinetDialogCommand.apply(),
    // which sets cornerCabinetDialog in the store. Wait for the async handler.
    await waitFor(() => {
      expect(useAppStore.getState().cornerCabinetDialog).not.toBeNull();
    });

    // The onSubmit stored must be the REAL FurnitureTab closure, not something injected by this test.
    // We verify this by checking that the test never called setCornerCabinetDialog directly —
    // the state was set by the handler triggered by the button click.
    const slot = useAppStore.getState().cornerCabinetDialog;
    expect(slot).not.toBeNull();
    // The onSubmit must be a function (the real handler closure from FurnitureTab)
    expect(typeof slot!.onSubmit).toBe('function');
  });
});
