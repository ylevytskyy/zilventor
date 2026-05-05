import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NewDrawingDialog } from '../NewDrawingDialog';
import { useAppStore } from '../../store/useAppStore';

// Mock bus.execute so we can spy without a real kernel
const mockExecute = vi.fn().mockResolvedValue(undefined);

describe('NewDrawingDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      newDrawingDialogOpen: false,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when newDrawingDialogOpen is false', () => {
    render(<NewDrawingDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when newDrawingDialogOpen is true', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    expect(screen.getByRole('dialog', { name: /new drawing/i })).toBeInTheDocument();
  });

  it('shows ISO sheet size options A0–A4 plus Custom', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    const select = screen.getByLabelText(/sheet size/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('A0');
    expect(options).toContain('A1');
    expect(options).toContain('A2');
    expect(options).toContain('A3');
    expect(options).toContain('A4');
    expect(options).toContain('custom');
  });

  it('shows width + height inputs only when Custom is selected', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    // Default is A3 — no custom size inputs
    expect(screen.queryByLabelText(/width.*mm/i)).toBeNull();
    expect(screen.queryByLabelText(/height.*mm/i)).toBeNull();
    // Switch to Custom
    fireEvent.change(screen.getByLabelText(/sheet size/i), { target: { value: 'custom' } });
    expect(screen.getByLabelText(/width.*mm/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/height.*mm/i)).toBeInTheDocument();
  });

  it('shows Landscape / Portrait radios; Landscape default for A3', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    const landscape = screen.getByRole('radio', { name: /landscape/i }) as HTMLInputElement;
    const portrait = screen.getByRole('radio', { name: /portrait/i }) as HTMLInputElement;
    expect(landscape.checked).toBe(true);
    expect(portrait.checked).toBe(false);
  });

  it('clicking Cancel closes the dialog without executing a command', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useAppStore.getState().newDrawingDialogOpen).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('clicking OK with a selected source path calls bus.execute(CreateDrawingCommand) and closes', async () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    // Inject a pre-filled source path via the store slot (OPFS picker can't run in jsdom)
    // Use act() to flush the re-render caused by setState before asserting on the DOM
    act(() => {
      useAppStore.setState({ newDrawingSourcePath: 'parts/cabinet.zipt', newDrawingSourceKind: 'part' } as any);
    });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('CreateDrawingCommand');
    expect(useAppStore.getState().newDrawingDialogOpen).toBe(false);
  });

  it('OK button is disabled when no source is selected', () => {
    useAppStore.setState({ newDrawingDialogOpen: true, newDrawingSourcePath: null } as any);
    render(<NewDrawingDialog />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
  });

  it('selecting Custom size and providing values passes widthMm/heightMm in the command', async () => {
    // Set all state before render so the button is enabled from the start
    useAppStore.setState({
      newDrawingDialogOpen: true,
      newDrawingSourcePath: 'parts/p.zipt',
      newDrawingSourceKind: 'part',
    } as any);
    render(<NewDrawingDialog />);
    fireEvent.change(screen.getByLabelText(/sheet size/i), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText(/width.*mm/i), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText(/height.*mm/i), { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    const [cmd] = mockExecute.mock.calls[0]!;
    const opts = (cmd as any).opts as { sheetSize: { kind: string; widthMm: number; heightMm: number } };
    expect(opts.sheetSize.kind).toBe('custom');
    expect(opts.sheetSize.widthMm).toBe(500);
    expect(opts.sheetSize.heightMm).toBe(350);
  });
});
