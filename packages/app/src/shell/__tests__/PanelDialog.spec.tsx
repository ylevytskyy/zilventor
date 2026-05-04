import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AssemblyDocument, MaterialEntry, PanelFeature } from '@zilventor/shared';
import { useAppStore, type PanelDialogState } from '../../store/useAppStore';
import { PanelDialog } from '../PanelDialog';

const seedAssembly = (mats: MaterialEntry[]): AssemblyDocument => ({
  id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
  components: [], constraints: [], groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: mats,
  hardware: [],
});

const MATS: MaterialEntry[] = [
  { id: 'm-birch', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' },
  { id: 'm-oak', name: 'Oak 22', defaultThickness: 22, color: '#7a5a30' },
];

function openDialog(opts: Partial<PanelDialogState> = {}) {
  const slot: PanelDialogState = {
    mode: 'part',
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...opts,
  };
  useAppStore.getState().setPanelDialog(slot);
  return slot;
}

describe('PanelDialog', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setPanelDialog(null);
  });

  it('renders all field groups (Dimensions, Material, Grain, Edge bands)', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    openDialog();
    render(<PanelDialog />);
    expect(screen.getByRole('heading', { name: /dimensions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /material/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /grain/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /edge bands/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Length' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Width' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Thickness' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^material$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/edge front/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/edge back/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/edge left/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/edge right/i)).toBeInTheDocument();
  });

  it('initial Material picker pre-fills Thickness from material; flag remains true', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    openDialog();
    render(<PanelDialog />);
    const thickness = screen.getByLabelText(/^thickness$/i) as HTMLInputElement;
    // First material is Birch 18 → defaults to 18
    expect(thickness.value).toBe('18');
    expect(screen.getByTestId('thickness-from-material-badge')).toBeInTheDocument();
  });

  it('typing in Thickness clears the from-material flag', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    openDialog();
    render(<PanelDialog />);
    expect(screen.getByTestId('thickness-from-material-badge')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^thickness$/i), { target: { value: '20' } });
    expect(screen.queryByTestId('thickness-from-material-badge')).toBeNull();
  });

  it('changing material with flag=true re-fills thickness', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    openDialog();
    render(<PanelDialog />);
    const thickness = screen.getByLabelText(/^thickness$/i) as HTMLInputElement;
    expect(thickness.value).toBe('18');
    fireEvent.change(screen.getByLabelText(/^material$/i), { target: { value: 'm-oak' } });
    expect(thickness.value).toBe('22');
  });

  it('changing material with flag=false leaves thickness untouched', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    openDialog();
    render(<PanelDialog />);
    // First clear the flag by typing
    fireEvent.change(screen.getByLabelText(/^thickness$/i), { target: { value: '25' } });
    expect(screen.queryByTestId('thickness-from-material-badge')).toBeNull();
    // Now change material
    fireEvent.change(screen.getByLabelText(/^material$/i), { target: { value: 'm-oak' } });
    const thickness = screen.getByLabelText(/^thickness$/i) as HTMLInputElement;
    expect(thickness.value).toBe('25');
  });

  it('grain radios are exclusive', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    openDialog();
    render(<PanelDialog />);
    const lengthRadio = screen.getByRole('radio', { name: /length/i }) as HTMLInputElement;
    const widthRadio = screen.getByRole('radio', { name: /width/i }) as HTMLInputElement;
    const noneRadio = screen.getByRole('radio', { name: /none/i }) as HTMLInputElement;
    expect(lengthRadio.checked).toBe(true);
    fireEvent.click(widthRadio);
    expect(widthRadio.checked).toBe(true);
    expect(lengthRadio.checked).toBe(false);
    fireEvent.click(noneRadio);
    expect(noneRadio.checked).toBe(true);
    expect(widthRadio.checked).toBe(false);
  });

  it('edge band rows accept material picks independently', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    const slot = openDialog();
    render(<PanelDialog />);
    fireEvent.change(screen.getByLabelText(/edge front/i), { target: { value: 'm-birch' } });
    fireEvent.change(screen.getByLabelText(/edge left/i), { target: { value: 'm-oak' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(slot.onSubmit).toHaveBeenCalledTimes(1);
    const submitted = (slot.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PanelFeature;
    expect(submitted.edgeBands.front).toEqual({ materialId: 'm-birch' });
    expect(submitted.edgeBands.back).toBeNull();
    expect(submitted.edgeBands.left).toEqual({ materialId: 'm-oak' });
    expect(submitted.edgeBands.right).toBeNull();
  });

  it('OK submit produces a complete PanelFeature payload', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    const slot = openDialog();
    render(<PanelDialog />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Length' }), { target: { value: '800' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Width' }), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('radio', { name: /width/i }));
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(slot.onSubmit).toHaveBeenCalledTimes(1);
    const submitted = (slot.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PanelFeature;
    expect(submitted.kind).toBe('panel');
    expect(submitted.length).toEqual({ kind: 'literal', value: 800 });
    expect(submitted.width).toEqual({ kind: 'literal', value: 600 });
    expect(submitted.thickness).toEqual({ kind: 'literal', value: 18 });
    expect(submitted.thicknessFromMaterial).toBe(true);
    expect(submitted.materialId).toBe('m-birch');
    expect(submitted.grain).toBe('width');
    // Dialog closes after submit
    expect(useAppStore.getState().panelDialog).toBeNull();
  });

  it('Esc cancels without submitting', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    const slot = openDialog();
    render(<PanelDialog />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(slot.onSubmit).not.toHaveBeenCalled();
    expect(slot.onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().panelDialog).toBeNull();
  });

  it('clicking outside (on the backdrop) dismisses', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    const slot = openDialog();
    render(<PanelDialog />);
    fireEvent.click(screen.getByTestId('panel-dialog-backdrop'));
    expect(slot.onSubmit).not.toHaveBeenCalled();
    expect(slot.onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().panelDialog).toBeNull();
  });

  it('shows broken-material-ref error when materialId does not resolve in active registry', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seedAssembly(MATS) });
    const initial: PanelFeature = {
      kind: 'panel',
      id: 'pf-1',
      length: { kind: 'literal', value: 600 },
      width: { kind: 'literal', value: 400 },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: false,
      materialId: 'm-missing',
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    openDialog({ initial });
    render(<PanelDialog />);
    expect(screen.getByRole('alert').textContent).toMatch(/m-missing/i);
  });
});
