import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MaterialRegistry } from '@zilventor/shared';
import { ImportAbfFlattenDxfDialog } from '../ImportAbfFlattenDxfDialog';

const MATERIALS: MaterialRegistry = [
  { id: 'mat-auto', name: 'Auto White', defaultThickness: 18, color: '#ffffff' },
  { id: 'mat-pearls', name: 'Sree Pearls', defaultThickness: 18, color: '#eeeeee' },
];

describe('ImportAbfFlattenDxfDialog', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ImportAbfFlattenDxfDialog
        isOpen={false}
        groupTokens={['AUTO_THICKNESS_18']}
        materials={MATERIALS}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per detected material-group token', () => {
    render(
      <ImportAbfFlattenDxfDialog
        isOpen={true}
        groupTokens={['AUTO_THICKNESS_18', 'SREE_PEARLS_2_THICKNESS_18']}
        materials={MATERIALS}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    expect(screen.getByText('AUTO_THICKNESS_18')).toBeInTheDocument();
    expect(screen.getByText('SREE_PEARLS_2_THICKNESS_18')).toBeInTheDocument();
  });

  it('prefills thickness from the <mm> token', () => {
    render(
      <ImportAbfFlattenDxfDialog
        isOpen={true}
        groupTokens={['AUTO_THICKNESS_18']}
        materials={MATERIALS}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    const thicknessInput = screen.getByLabelText(/thickness.*AUTO_THICKNESS_18/i) as HTMLInputElement;
    expect(thicknessInput.value).toBe('18');
  });

  it('defaults the material picker to the first registry entry', () => {
    render(
      <ImportAbfFlattenDxfDialog
        isOpen={true}
        groupTokens={['AUTO_THICKNESS_18']}
        materials={MATERIALS}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    const materialSelect = screen.getByLabelText(/material.*AUTO_THICKNESS_18/i) as HTMLSelectElement;
    expect(materialSelect.value).toBe('mat-auto');
  });

  it('onConfirm returns per-group groupToken/materialId/thickness selections, reflecting user edits', () => {
    const onConfirm = vi.fn();
    render(
      <ImportAbfFlattenDxfDialog
        isOpen={true}
        groupTokens={['AUTO_THICKNESS_18', 'SREE_PEARLS_2_THICKNESS_18']}
        materials={MATERIALS}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    );
    fireEvent.change(screen.getByLabelText(/material.*SREE_PEARLS_2_THICKNESS_18/i), { target: { value: 'mat-pearls' } });
    fireEvent.change(screen.getByLabelText(/thickness.*AUTO_THICKNESS_18/i), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    expect(onConfirm).toHaveBeenCalledWith([
      { groupToken: 'AUTO_THICKNESS_18', materialId: 'mat-auto', thickness: 16 },
      { groupToken: 'SREE_PEARLS_2_THICKNESS_18', materialId: 'mat-pearls', thickness: 18 },
    ]);
  });

  it('Cancel button fires onCancel without calling onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ImportAbfFlattenDxfDialog
        isOpen={true}
        groupTokens={['AUTO_THICKNESS_18']}
        materials={MATERIALS}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
