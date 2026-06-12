/**
 * SC-12: Real UI-wiring test — renders InspectTab, clicks the button,
 * submits the dialog, and asserts store clashRows populates.
 * kernel.checkInterference is MOCKED to return a known ClashPair[].
 * Does NOT inject its own onSubmit — the wiring goes through the real InspectTab handler.
 *
 * SC-12 also tests row-click calls selectComponentPaths + setClashHighlightKeys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InspectTab from '../InspectTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

// Mock OPFS — not available in jsdom
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(new Uint8Array()),
      write: vi.fn(),
      exists: vi.fn().mockResolvedValue(false),
    }),
  },
}));

// Mock runInterferenceCheck at module level so we control return value.
vi.mock('../../../assembly/runInterferenceCheck', () => ({
  runInterferenceCheck: vi.fn().mockResolvedValue([
    {
      aPathKey: 'c1',
      bPathKey: 'c2',
      aPath: ['c1'],
      bPath: ['c2'],
      aName: 'Panel A',
      bName: 'Panel B',
      kind: 'interference',
      volume: 1800,
    },
  ]),
}));

import { runInterferenceCheck } from '../../../assembly/runInterferenceCheck';

const seedAsm: AssemblyDocument = {
  id: 'asm-inspect', name: 'InspectTest', units: 'mm', parameters: {}, properties: {},
  components: [
    { id: 'c1', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'c2', partPath: 'parts/b.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

function setActiveAssembly(): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: seedAsm },
    activeAssembly: seedAsm,
    activePart: null,
    // Provide a minimal kernel mock with checkInterference
    kernel: {
      checkInterference: vi.fn().mockResolvedValue([]),
    } as any,
    subAssemblyDocs: {},
    subAssemblyInnerPoses: {},
    componentPoses: new Map(),
    clashRows: null,
    clashRan: false,
    clashHighlightKeys: [],
  } as any);
}

describe('InspectTab — clash check wiring (SC-12)', () => {
  beforeEach(() => {
    setActiveAssembly();
    vi.mocked(runInterferenceCheck).mockResolvedValue([
      {
        aPathKey: 'c1',
        bPathKey: 'c2',
        aPath: ['c1'],
        bPath: ['c2'],
        aName: 'Panel A',
        bName: 'Panel B',
        kind: 'interference',
        volume: 1800,
      },
    ]);
  });

  it('renders the Interference Check button', () => {
    render(<InspectTab />);
    expect(screen.getByRole('button', { name: /Interference Check/i })).toBeTruthy();
  });

  it('button is disabled when no active assembly', () => {
    useAppStore.setState({ activeAssembly: null, kernel: null } as any);
    render(<InspectTab />);
    expect(screen.getByRole('button', { name: /Interference Check/i })).toBeDisabled();
  });

  it('clicking button opens the clearance dialog', () => {
    render(<InspectTab />);
    fireEvent.click(screen.getByRole('button', { name: /Interference Check/i }));
    expect(screen.getByText(/Minimum clearance/i)).toBeTruthy();
  });

  it('submitting the dialog calls runInterferenceCheck and populates clashRows', async () => {
    render(<InspectTab />);
    fireEvent.click(screen.getByRole('button', { name: /Interference Check/i }));

    // Confirm the default clearance value is present
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(parseFloat(input.value)).toBeGreaterThan(0);

    // Click Run
    fireEvent.click(screen.getByRole('button', { name: /^Run$/i }));

    await waitFor(() => {
      expect(runInterferenceCheck).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(useAppStore.getState().clashRan).toBe(true);
      expect(useAppStore.getState().clashRows).toHaveLength(1);
    });
  });

  it('row click calls selectComponentPaths with ComponentPath arrays (SC-7)', async () => {
    useAppStore.setState({
      clashRows: [
        { aPathKey: 'c1', bPathKey: 'c2', aPath: ['c1'], bPath: ['c2'], aName: 'Panel A', bName: 'Panel B', kind: 'interference', volume: 1800 },
      ],
      clashRan: true,
    } as any);

    const spy = vi.spyOn(useAppStore.getState(), 'selectComponentPaths');

    render(<InspectTab />);

    const row = screen.getByText('Panel A').closest('tr')!;
    fireEvent.click(row);

    expect(spy).toHaveBeenCalledWith([['c1'], ['c2']]);
  });

  it('row click sets clashHighlightKeys in store', async () => {
    useAppStore.setState({
      clashRows: [
        { aPathKey: 'c1', bPathKey: 'c2', aPath: ['c1'], bPath: ['c2'], aName: 'Panel A', bName: 'Panel B', kind: 'interference', volume: 1800 },
      ],
      clashRan: true,
    } as any);

    render(<InspectTab />);
    const row = screen.getByText('Panel A').closest('tr')!;
    fireEvent.click(row);

    expect(useAppStore.getState().clashHighlightKeys).toEqual(['c1', 'c2']);
  });
});
