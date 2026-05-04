import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NestDialog } from '../NestDialog';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

// Prevent real packing algorithm from running in unit tests.
vi.mock('../../commands/GenerateNestCommand', () => ({
  GenerateNestCommand: vi.fn().mockImplementation(() => ({
    name: 'GenerateNest',
    apply: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { GenerateNestCommand } from '../../commands/GenerateNestCommand';

function seedAsm(): void {
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Project', units: 'mm',
    parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [
      { id: 'm1', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896', sheetLengthMm: 2440, sheetWidthMm: 1220 },
    ],
    hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}

describe('NestDialog', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setNestDialog(null);
    vi.clearAllMocks();
  });

  it('renders nothing when nestDialog is null', () => {
    seedAsm();
    const { container } = render(<NestDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders kerf input, summary, and OK/Cancel buttons when open', () => {
    seedAsm();
    useAppStore.getState().setNestDialog({ kind: 'open' });
    render(<NestDialog />);
    expect(screen.getByLabelText('Kerf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    // summary line is visible
    expect(screen.getByText(/panels across.*materials will be nested/)).toBeTruthy();
  });

  it('OK runs GenerateNestCommand via bus and closes dialog', async () => {
    seedAsm();
    useAppStore.getState().setNestDialog({ kind: 'open' });
    render(<NestDialog />);

    const kerfInput = screen.getByLabelText('Kerf');
    // default is '3', OK should be enabled
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(GenerateNestCommand).toHaveBeenCalledTimes(1);
      expect(GenerateNestCommand).toHaveBeenCalledWith(expect.objectContaining({ kerfMm: 3 }));
      expect(useAppStore.getState().nestDialog).toBeNull();
    });
    // suppress unused-var warning
    void kerfInput;
  });

  it('Cancel closes dialog without running GenerateNestCommand', () => {
    seedAsm();
    useAppStore.getState().setNestDialog({ kind: 'open' });
    render(<NestDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useAppStore.getState().nestDialog).toBeNull();
    expect(GenerateNestCommand).not.toHaveBeenCalled();
  });

  it('Esc closes dialog without running GenerateNestCommand', () => {
    seedAsm();
    useAppStore.getState().setNestDialog({ kind: 'open' });
    render(<NestDialog />);

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(useAppStore.getState().nestDialog).toBeNull();
    expect(GenerateNestCommand).not.toHaveBeenCalled();
  });

  it('OK is disabled when kerf is empty, non-positive, or non-numeric', () => {
    seedAsm();
    useAppStore.getState().setNestDialog({ kind: 'open' });
    render(<NestDialog />);

    const kerfInput = screen.getByLabelText('Kerf');
    const okBtn = screen.getByRole('button', { name: 'OK' });

    // empty
    fireEvent.change(kerfInput, { target: { value: '' } });
    expect(okBtn).toHaveAttribute('aria-disabled', 'true');
    expect(okBtn).toBeDisabled();

    // zero
    fireEvent.change(kerfInput, { target: { value: '0' } });
    expect(okBtn).toHaveAttribute('aria-disabled', 'true');

    // negative
    fireEvent.change(kerfInput, { target: { value: '-1' } });
    expect(okBtn).toHaveAttribute('aria-disabled', 'true');

    // non-numeric
    fireEvent.change(kerfInput, { target: { value: 'abc' } });
    expect(okBtn).toHaveAttribute('aria-disabled', 'true');

    // valid again
    fireEvent.change(kerfInput, { target: { value: '3' } });
    expect(okBtn).not.toHaveAttribute('aria-disabled', 'true');
  });
});
