// packages/app/src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { MaterialRegistryEditor } from '../MaterialRegistryEditor';
import { useAppStore } from '../../store/useAppStore';

function seedPartWithMaterial(opts: {
  hatchAngleDeg?: number;
  hatchSpacingMm?: number;
} = {}): void {
  const mat: Record<string, unknown> = {
    id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc',
  };
  if (opts.hatchAngleDeg !== undefined) mat.hatchAngleDeg = opts.hatchAngleDeg;
  if (opts.hatchSpacingMm !== undefined) mat.hatchSpacingMm = opts.hatchSpacingMm;

  const part = {
    id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {},
    featureTree: [], materials: [mat], hardware: [],
  };
  useAppStore.setState({
    activePart: part,
    activeAssembly: null,
    activeDocument: { kind: 'part', document: part },
  } as never);
}

describe('MaterialRegistryEditor — hatch angle/spacing UI', () => {
  let executeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executeSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ bus: { execute: executeSpy } } as never);
  });

  it('renders Hatch angle (°) and Hatch spacing (mm) column headers', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    expect(screen.getByRole('columnheader', { name: /Hatch angle/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Hatch spacing/i })).toBeInTheDocument();
  });

  it('read-only row shows hatch values when set', () => {
    seedPartWithMaterial({ hatchAngleDeg: 30, hatchSpacingMm: 2 });
    render(<MaterialRegistryEditor />);
    const row = screen.getByTestId('material-row-m1');
    expect(within(row).getByText('30')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('read-only row shows blank cells when hatch absent', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    const tds = within(screen.getByTestId('material-row-m1')).getAllByRole('cell');
    // Columns: Name, Thickness, Color, Sheet L, Sheet W, Hatch angle, Hatch spacing, Actions
    expect(tds[5]?.textContent ?? '').toBe('');
    expect(tds[6]?.textContent ?? '').toBe('');
  });

  it('entering edit mode prefills hatch inputs from the material', () => {
    seedPartWithMaterial({ hatchAngleDeg: 30, hatchSpacingMm: 2 });
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    expect((screen.getByLabelText(/Edit hatch angle/i) as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText(/Edit hatch spacing/i) as HTMLInputElement).value).toBe('2');
  });

  it('entering edit mode prefills empty strings when hatch fields absent', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    expect((screen.getByLabelText(/Edit hatch angle/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Edit hatch spacing/i) as HTMLInputElement).value).toBe('');
  });

  it('half-pair (angle set, spacing empty) shows error and blocks save', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '30' } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/both Hatch angle and Hatch spacing/i);
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('out-of-range angle (200) shows error', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '2' } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/angle must be in \[0, 180\)/i);
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('non-positive spacing (0) shows error', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '0' } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/spacing must be > 0/i);
    });
  });

  it('both-set valid submit dispatches EditMaterialCommand with numeric hatch fields', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '2' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const cmd = executeSpy.mock.calls[0]![0] as { id: string; patch: Record<string, unknown> };
    expect(cmd.id).toBe('m1');
    expect(cmd.patch.hatchAngleDeg).toBe(20);
    expect(cmd.patch.hatchSpacingMm).toBe(2);
    expect(cmd.patch.clearHatch).toBeUndefined();
  });

  it('both-empty submit (starting from hatch set) dispatches with clearHatch', async () => {
    seedPartWithMaterial({ hatchAngleDeg: 30, hatchSpacingMm: 2 });
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const cmd = executeSpy.mock.calls[0]![0] as { id: string; patch: Record<string, unknown> };
    expect(cmd.patch.clearHatch).toBe(true);
    expect(cmd.patch.hatchAngleDeg).toBeUndefined();
    expect(cmd.patch.hatchSpacingMm).toBeUndefined();
  });
});
