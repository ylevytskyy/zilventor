import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AssemblyDocument } from '@zilventor/shared';

// ----- module mocks -----

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => `[${k}]` }),
}));

// Minimal store: activeAssembly with one component; no subAssemblies.
vi.mock('../../store/useAppStore', () => {
  const asm: AssemblyDocument = {
    formatVersion: 22,
    kind: 'assembly',
    name: 'Asm',
    components: [{ id: 'c1', partPath: 'parts/side.zipt', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } }],
    mates: [],
    features: [],
  };
  return {
    useAppStore: (sel: (s: { activeAssembly: AssemblyDocument | null; subAssemblyDocs: Record<string, AssemblyDocument> }) => unknown) =>
      sel({ activeAssembly: asm, subAssemblyDocs: {} }),
  };
});

// Stub aggregateConnectorBomRecursive to return one raw row.
vi.mock('../../assembly/walkers/aggregateConnectorBomRecursive', () => ({
  aggregateConnectorBomRecursive: () => [
    { kind: 'confirmat', nameKey: 'bom.connector.confirmat', qty: 4, notes: 'Ø7 face + Ø5 edge' },
  ],
}));

// Provide a minimal CutListCacheContext via mock.
vi.mock('../CutListCacheContext', () => ({
  useCutListCacheContext: () => ({
    partBoresCacheRef: { current: new Map([['parts/side.zipt', []]]) },
    partInfoCacheRef: { current: new Map() },
    panelSpecCacheRef: { current: new Map() },
    warmCache: () => Promise.resolve(),
    invalidatePartPaths: () => Promise.resolve(),
  }),
}));

import { useConnectorBomResult } from '../useConnectorBomResult';

describe('useConnectorBomResult', () => {
  it('resolves nameKey to a display name via t()', () => {
    const { result } = renderHook(() => useConnectorBomResult());
    expect(result.current).toHaveLength(1);
    // t('[bom.connector.confirmat]') wraps the key in brackets per our mock
    expect(result.current[0].name).toBe('[bom.connector.confirmat]');
  });

  it('returns rows with kind, qty, notes preserved', () => {
    const { result } = renderHook(() => useConnectorBomResult());
    const row = result.current[0];
    expect(row.kind).toBe('confirmat');
    expect(row.qty).toBe(4);
    expect(row.notes).toBe('Ø7 face + Ø5 edge');
  });

  it('rows do NOT contain nameKey (display layer has resolved name only)', () => {
    const { result } = renderHook(() => useConnectorBomResult());
    expect((result.current[0] as { nameKey?: string }).nameKey).toBeUndefined();
  });
});
