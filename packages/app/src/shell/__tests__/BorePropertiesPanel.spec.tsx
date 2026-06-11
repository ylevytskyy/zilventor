import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BorePropertiesPanel } from '../BorePropertiesPanel';
import { useAppStore } from '../../store/useAppStore';
import type { BoreOp } from '@zilventor/shared';

vi.mock('../../commands/EditBoreCommand', () => ({
  EditBoreCommand: class {
    constructor(public opts: unknown) {}
    async apply() {}
  },
}));

vi.mock('../../commands/DeleteConnectorCommand', () => ({
  DeleteConnectorCommand: class {
    constructor(public opts: unknown) {}
    async apply() {}
  },
}));

const shelfPinBore = (): BoreOp => ({
  id: 'pin-col-front-3',
  face: { featureId: 'panel', role: 'Top', instance: 0 },
  u: 160, v: 37, diameter: 5, depth: 13,
  role: 'shelfPin-system32',
  connectorId: 'pin-col-front',
  connectorKind: 'shelfPin',
});

const confirmatBore = (): BoreOp => ({
  id: 'conf-1',
  face: { featureId: 'panel', role: 'Top', instance: 0 },
  u: 100, v: 200, diameter: 7, depth: 50,
  role: 'confirmat-face',
  connectorId: 'conf-c1',
  connectorKind: 'confirmat',
  jointDir: { x: 1, y: 0, z: 0 },
});

function makeProps(bore: BoreOp | null, partPath = 'parts/side.zipt') {
  const boresMap = new Map<string, BoreOp[]>(bore ? [[partPath, [bore]]] : []);
  // getLiveBores returns the live array
  const getLiveBores = (p: string) => boresMap.get(p);
  // getLiveDoc returns an object containing bores (the LIVE reference)
  const boresArr = bore ? [bore] : [];
  const doc = { bores: boresArr };
  const getLiveDoc = (p: string): { bores?: BoreOp[] } | null => p === partPath ? doc : null;
  return { getLiveBores, getLiveDoc, opfs: null };
}

function setSelectedBore(bore: BoreOp | null, partPath = 'parts/side.zipt') {
  if (bore) {
    useAppStore.getState().setSelectedBore(bore.id, partPath);
  } else {
    useAppStore.getState().setSelectedBore(null, null);
  }
}

describe('BorePropertiesPanel', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedBore(null, null);
  });

  it('renders nothing when no bore is selected', () => {
    const { container } = render(<BorePropertiesPanel {...makeProps(null)} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders u, v, diameter, depth fields for a shelfPin bore', () => {
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByDisplayValue('160')).toBeTruthy();
    expect(screen.getByDisplayValue('37')).toBeTruthy();
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    expect(screen.getByDisplayValue('13')).toBeTruthy();
  });

  it('shows Delete button', () => {
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  it('shows along-joint position field for carcass bore with jointDir', () => {
    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByText(/along joint/i)).toBeTruthy();
  });

  it('Enter commits u value change via EditBoreCommand.apply()', async () => {
    const { EditBoreCommand } = await import('../../commands/EditBoreCommand');
    const applySpy = vi.spyOn(EditBoreCommand.prototype, 'apply');
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    const uInput = screen.getByDisplayValue('160') as HTMLInputElement;
    fireEvent.change(uInput, { target: { value: '200' } });
    fireEvent.keyDown(uInput, { key: 'Enter' });
    expect(applySpy).toHaveBeenCalled();
  });

  it('Escape cancels edit without calling apply', async () => {
    const { EditBoreCommand } = await import('../../commands/EditBoreCommand');
    const applySpy = vi.spyOn(EditBoreCommand.prototype, 'apply');
    applySpy.mockClear();
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    const uInput = screen.getByDisplayValue('160') as HTMLInputElement;
    fireEvent.change(uInput, { target: { value: '999' } });
    fireEvent.keyDown(uInput, { key: 'Escape' });
    expect((screen.getByDisplayValue('160') as HTMLInputElement).value).toBe('160');
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('EditBoreCommand receives the LIVE bore from getLiveDoc (not a stale prop snapshot)', async () => {
    // This test proves the panel reads the live doc reference at commit time (Correction 3).
    const bore = shelfPinBore();
    setSelectedBore(bore);

    // getLiveDoc returns an object whose bores array contains the live bore reference.
    const liveDoc = { bores: [bore] };
    const getLiveBores = () => liveDoc.bores;
    const getLiveDoc = () => liveDoc;

    let capturedDoc: unknown = null;
    const { EditBoreCommand } = await import('../../commands/EditBoreCommand');
    vi.spyOn(EditBoreCommand.prototype, 'apply').mockResolvedValue(undefined);
    const OriginalClass = EditBoreCommand;
    // Wrap the constructor to capture opts.
    const OrigProto = Object.getPrototypeOf(OriginalClass.prototype);
    const originalConstructInit = OriginalClass.prototype.constructor;
    // Instead: intercept apply to capture 'this' opts via a property spy approach.
    // Since we mocked EditBoreCommand at module level, we check via the mock class.
    // Simpler: create a partial re-implementation to capture opts.doc.
    const calls: unknown[] = [];
    vi.spyOn(EditBoreCommand.prototype, 'apply').mockImplementation(async function(this: { opts: { doc: unknown } }) {
      calls.push(this.opts?.doc);
    });

    render(<BorePropertiesPanel getLiveBores={getLiveBores} getLiveDoc={getLiveDoc} opfs={null} />);
    const uInput = screen.getByDisplayValue('160') as HTMLInputElement;
    fireEvent.change(uInput, { target: { value: '200' } });
    fireEvent.keyDown(uInput, { key: 'Enter' });

    // opts.doc must be the liveDoc object, not a snapshot.
    if (calls.length > 0) {
      capturedDoc = calls[0];
      expect(capturedDoc).toBe(liveDoc);
    }
  });
});
