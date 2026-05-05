import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditTitleBlockDialog } from '../EditTitleBlockDialog';
import { useAppStore } from '../../store/useAppStore';

const mockExecute = vi.fn().mockResolvedValue(undefined);

describe('EditTitleBlockDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      editTitleBlockDialogState: null,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when editTitleBlockDialogState is null', () => {
    render(<EditTitleBlockDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders all TitleBlockOverrides fields when open', () => {
    useAppStore.setState({
      editTitleBlockDialogState: {
        sheetId: 'sh1',
        initialOverrides: { drawingName: 'My Drawing', drawnBy: 'JD' },
      },
    } as any);
    render(<EditTitleBlockDialog />);
    expect(screen.getByRole('dialog', { name: /title block/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/drawing name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/part name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drawn by/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/approved by/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/material/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/revision/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
  });

  it('pre-fills initial override values', () => {
    useAppStore.setState({
      editTitleBlockDialogState: {
        sheetId: 'sh1',
        initialOverrides: { drawingName: 'My Drawing', drawnBy: 'JD' },
      },
    } as any);
    render(<EditTitleBlockDialog />);
    expect((screen.getByLabelText(/drawing name/i) as HTMLInputElement).value).toBe('My Drawing');
    expect((screen.getByLabelText(/drawn by/i) as HTMLInputElement).value).toBe('JD');
  });

  it('OK dispatches EditTitleBlockCommand with correct overrides and closes', async () => {
    useAppStore.setState({
      editTitleBlockDialogState: { sheetId: 'sh1', initialOverrides: {} },
    } as any);
    render(<EditTitleBlockDialog />);
    fireEvent.change(screen.getByLabelText(/drawing name/i), { target: { value: 'Cabinet Front' } });
    fireEvent.change(screen.getByLabelText(/drawn by/i), { target: { value: 'LY' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('EditTitleBlockCommand');
    expect((cmd as any).opts.sheetId).toBe('sh1');
    expect((cmd as any).opts.overrides.drawingName).toBe('Cabinet Front');
    expect((cmd as any).opts.overrides.drawnBy).toBe('LY');
    expect((useAppStore.getState() as any).editTitleBlockDialogState).toBeNull();
  });

  it('Cancel closes without executing command', () => {
    useAppStore.setState({
      editTitleBlockDialogState: { sheetId: 'sh1', initialOverrides: {} },
    } as any);
    render(<EditTitleBlockDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockExecute).not.toHaveBeenCalled();
    expect((useAppStore.getState() as any).editTitleBlockDialogState).toBeNull();
  });
});
