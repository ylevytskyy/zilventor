import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ModelTab from '../ModelTab';
import { useAppStore } from '../../../store/useAppStore';
import type { PartDocument, Feature } from '@zilventor/shared';

const ORIGIN_FEATURES: Feature[] = [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
];

const importedPart: PartDocument = {
  id: 'p-imported',
  name: 'Imported',
  units: 'mm',
  parameters: {},
  featureTree: [
    ...ORIGIN_FEATURES,
    { kind: 'imported', id: 'imp-1', sourceStep: 'X.step', bodyRef: 'blob-1' },
  ],
  properties: {},
  materials: [],
  hardware: [],
};

const parametricPart: PartDocument = {
  id: 'p-para',
  name: 'Para',
  units: 'mm',
  parameters: {},
  featureTree: [
    ...ORIGIN_FEATURES,
    {
      kind: 'sketch',
      id: 's1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [],
      constraints: [],
    },
    {
      kind: 'extrude',
      id: 'e1',
      sketchRef: 's1',
      distanceParam: 'd1',
      direction: 'forward',
      operation: 'new',
    },
  ],
  properties: {},
  materials: [],
  hardware: [],
};

beforeEach(() => {
  cleanup();
  useAppStore.setState({ activePart: null });
});

describe('ModelTab read-only enforcement', () => {
  it('disables every Add* button when active part is imported', () => {
    useAppStore.setState({ activePart: importedPart });
    render(<ModelTab />);
    const labels: Array<string | RegExp> = [
      'Extrude',
      /Revolve/,
      /Sweep/,
      /Plane/,
      /Axis/,
      /Point/,
      /Fillet/,
      /Chamfer/,
      /Shell/,
      /Hole/,
      /Linear Pattern/,
      /Mirror/,
    ];
    for (const l of labels) {
      const btn = screen.getByRole('button', { name: l });
      expect(btn).toBeDisabled();
    }
  });

  it('shows a "read-only" tooltip on each Add* button when active part is imported', () => {
    useAppStore.setState({ activePart: importedPart });
    render(<ModelTab />);
    const extrude = screen.getByRole('button', { name: 'Extrude' });
    expect(extrude.getAttribute('title') ?? '').toMatch(/imported.*read-only/i);
  });

  it('keeps "New Part" and "Parameters" enabled even on imported parts', () => {
    useAppStore.setState({ activePart: importedPart });
    render(<ModelTab />);
    expect(screen.getByRole('button', { name: /New Part/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Parameters/i })).not.toBeDisabled();
  });

  it('parametric part has Extrude enabled (sanity — read-only is not always-on)', () => {
    useAppStore.setState({ activePart: parametricPart });
    render(<ModelTab />);
    expect(screen.getByRole('button', { name: 'Extrude' })).not.toBeDisabled();
  });
});
