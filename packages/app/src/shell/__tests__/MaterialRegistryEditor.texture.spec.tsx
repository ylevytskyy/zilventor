import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { MaterialRegistryEditor } from '../MaterialRegistryEditor';
import { useAppStore } from '../../store/useAppStore';
import { BUILTIN_TEXTURE_DEFS } from '@zilventor/shared';

// Column order in the read-only row:
// [0] Name, [1] DefaultThickness, [2] Color, [3] SheetL, [4] SheetW,
// [5] HatchAngle, [6] HatchSpacing, [7] Texture, [8] Actions
const TEXTURE_COL_INDEX = 7;

function seedPartWithMaterial(textureId?: string): void {
  const mat: Record<string, unknown> = { id: 'm1', name: 'Oak Sheet', defaultThickness: 18, color: '#8b6914' };
  if (textureId !== undefined) mat.textureId = textureId;
  const part = { id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {}, featureTree: [], materials: [mat], hardware: [] };
  useAppStore.setState({ activePart: part, activeAssembly: null, activeDocument: { kind: 'part', document: part } } as never);
}

describe('MaterialRegistryEditor — texture picker', () => {
  let executeSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    executeSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ bus: { execute: executeSpy } } as never);
  });

  it('renders "Texture" column header', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    expect(screen.getByRole('columnheader', { name: /Texture/i })).toBeInTheDocument();
  });

  it('the texture select shows "— None —" plus all BUILTIN_TEXTURE_DEFS names', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Oak Sheet/i }));
    const select = screen.getByLabelText(/Edit texture/i) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.text);
    expect(optionTexts).toContain('— None —');
    for (const def of BUILTIN_TEXTURE_DEFS) expect(optionTexts).toContain(def.name);
  });

  it('entering edit mode prefills select with the material current textureId', () => {
    seedPartWithMaterial('oak');
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Oak Sheet/i }));
    expect((screen.getByLabelText(/Edit texture/i) as HTMLSelectElement).value).toBe('oak');
  });

  it('entering edit mode prefills empty string (None) when textureId absent', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Oak Sheet/i }));
    expect((screen.getByLabelText(/Edit texture/i) as HTMLSelectElement).value).toBe('');
  });

  it('selecting a texture and clicking Save dispatches EditMaterialCommand with textureId', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Oak Sheet/i }));
    fireEvent.change(screen.getByLabelText(/Edit texture/i), { target: { value: 'oak' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const cmd = executeSpy.mock.calls[0]![0] as { patch: Record<string, unknown> };
    expect(cmd.patch.textureId).toBe('oak');
  });

  it('selecting "— None —" and clicking Save dispatches EditMaterialCommand with textureId: undefined', async () => {
    seedPartWithMaterial('walnut');
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Oak Sheet/i }));
    fireEvent.change(screen.getByLabelText(/Edit texture/i), { target: { value: '' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const cmd = executeSpy.mock.calls[0]![0] as { patch: Record<string, unknown> };
    expect(cmd.patch.textureId).toBeUndefined();
  });

  it('read-only row shows the textureId when set', () => {
    seedPartWithMaterial('walnut');
    render(<MaterialRegistryEditor />);
    expect(within(screen.getByTestId('material-row-m1')).getByText('walnut')).toBeInTheDocument();
  });

  it('read-only row shows empty cell when textureId absent', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    const tds = within(screen.getByTestId('material-row-m1')).getAllByRole('cell');
    expect(tds[TEXTURE_COL_INDEX]?.textContent ?? '').toBe('');
  });
});
