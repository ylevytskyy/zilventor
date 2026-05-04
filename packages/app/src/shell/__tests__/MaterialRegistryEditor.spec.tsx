import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AssemblyDocument, MaterialEntry, PanelFeature, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { MaterialRegistryEditor } from '../MaterialRegistryEditor';

const seed = (mats: MaterialEntry[]): AssemblyDocument => ({
  id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
  components: [], constraints: [], groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: mats,
  hardware: [],
});

const partWithPanel = (materialId: string): PartDocument => {
  const panel: PanelFeature = {
    kind: 'panel', id: 'pf-1',
    length: { kind: 'literal', value: 600 },
    width: { kind: 'literal', value: 400 },
    thickness: { kind: 'literal', value: 18 },
    thicknessFromMaterial: true,
    materialId,
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
  };
  return {
    id: 'P1', name: 'P1', units: 'mm', parameters: {}, properties: {},
    featureTree: [panel],
    materials: [{ id: materialId, name: 'In-use', defaultThickness: 18, color: '#cccccc' }],
    hardware: [],
  };
};

const flush = async () => {
  await act(async () => { await Promise.resolve(); });
};

describe('MaterialRegistryEditor', () => {
  beforeEach(() => {
    // Reset to a clean assembly so each test is isolated.
    useAppStore.getState().setActiveDocument(null);
  });

  it('renders rows from the active registry', () => {
    const mats: MaterialEntry[] = [
      { id: 'm-a', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' },
      { id: 'm-b', name: 'Oak 22', defaultThickness: 22, color: '#7a5a30' },
    ];
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seed(mats) });
    render(<MaterialRegistryEditor />);
    expect(screen.getByText('Birch 18')).toBeInTheDocument();
    expect(screen.getByText('Oak 22')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('Add appends a new row with default values', async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seed([]) });
    render(<MaterialRegistryEditor />);
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }));
    fireEvent.change(screen.getByLabelText(/new material name/i), { target: { value: 'Walnut 18' } });
    fireEvent.change(screen.getByLabelText(/new material default thickness/i), { target: { value: '18' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
      await Promise.resolve();
    });
    const mats = useAppStore.getState().activeAssembly!.materials;
    expect(mats).toHaveLength(1);
    expect(mats[0]!.name).toBe('Walnut 18');
    expect(mats[0]!.defaultThickness).toBe(18);
    expect(screen.getByText('Walnut 18')).toBeInTheDocument();
  });

  it('Edit updates row in place', async () => {
    const mats: MaterialEntry[] = [
      { id: 'm-a', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' },
    ];
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seed(mats) });
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m-a'));
    fireEvent.click(screen.getByRole('button', { name: /edit birch 18/i }));
    fireEvent.change(screen.getByLabelText(/edit name/i), { target: { value: 'Birch 22' } });
    fireEvent.change(screen.getByLabelText(/edit default thickness/i), { target: { value: '22' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await Promise.resolve();
    });
    const updated = useAppStore.getState().activeAssembly!.materials[0]!;
    expect(updated.name).toBe('Birch 22');
    expect(updated.defaultThickness).toBe(22);
  });

  it('Delete confirms inline; surfaces MATERIAL_IN_USE when referenced by a panel', async () => {
    // Use a part doc so DeleteMaterialCommand can find the panel reference.
    useAppStore.getState().setActivePart(partWithPanel('m-used'));
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m-used'));
    fireEvent.click(screen.getByRole('button', { name: /delete in-use/i }));
    // Inline confirm appears
    expect(screen.getByText(/delete "in-use"\?/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/MATERIAL_IN_USE/);
    // The material should remain in the registry.
    expect(useAppStore.getState().activePart!.materials).toHaveLength(1);
  });

  it('Delete succeeds when no references; row disappears', async () => {
    const mats: MaterialEntry[] = [
      { id: 'm-loose', name: 'Loose', defaultThickness: 18, color: '#cccccc' },
    ];
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seed(mats) });
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m-loose'));
    fireEvent.click(screen.getByRole('button', { name: /delete loose/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
      await Promise.resolve();
    });
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(0);
  });

  it('rejects duplicate name (case-insensitive)', async () => {
    const mats: MaterialEntry[] = [
      { id: 'm-a', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' },
    ];
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: seed(mats) });
    render(<MaterialRegistryEditor />);
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }));
    fireEvent.change(screen.getByLabelText(/new material name/i), { target: { value: 'birch 18' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/i);
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(1);
  });
});
