// packages/app/src/store/__tests__/activeDrawingSourcePartId.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';
import { useAppStore } from '../useAppStore';
import { drawingDocState } from '../drawingDocState';

// Reset the store before and after each test so mutations in one test never
// pollute other tests in this file (or other files sharing the same worker).
beforeEach(() => {
  useAppStore.setState({
    activeDrawingSourcePartId: null,
    activeDrawingSourceFingerprint: null,
    activeDrawingSourceComponents: null,
  } as never);
});

afterEach(() => {
  useAppStore.setState({
    activeDrawingSourcePartId: null,
    activeDrawingSourceFingerprint: null,
    activeDrawingSourceComponents: null,
  } as never);
});

describe('activeDrawingSourcePartId + activeDrawingSourceFingerprint store slots', () => {
  it('activeDrawingSourcePartId defaults to null', () => {
    const state = useAppStore.getState();
    expect('activeDrawingSourcePartId' in state).toBe(true);
    expect((state as unknown as { activeDrawingSourcePartId: unknown }).activeDrawingSourcePartId).toBeNull();
  });

  it('activeDrawingSourceFingerprint defaults to null', () => {
    const state = useAppStore.getState();
    expect('activeDrawingSourceFingerprint' in state).toBe(true);
    expect((state as unknown as { activeDrawingSourceFingerprint: unknown }).activeDrawingSourceFingerprint).toBeNull();
  });

  it('both slots can be set to strings', () => {
    useAppStore.setState({
      activeDrawingSourcePartId: 'kernel-part-uuid-123',
      activeDrawingSourceFingerprint: 'fp-abc123',
    } as never);
    const s = useAppStore.getState() as unknown as {
      activeDrawingSourcePartId: string | null;
      activeDrawingSourceFingerprint: string | null;
    };
    expect(s.activeDrawingSourcePartId).toBe('kernel-part-uuid-123');
    expect(s.activeDrawingSourceFingerprint).toBe('fp-abc123');
  });

  it('drawingDocState does NOT reset source slots — they survive across view-add operations', () => {
    // drawingDocState is called by view-placement commands (AddBaseViewCommand, AddIsoViewCommand, etc.)
    // on every document edit. The source slots (set by CreateDrawingCommand → loadDrawingSource) must
    // survive these calls so that projectViewFromSource can call getProjectorInput after AddBaseViewCommand.
    // Only CreateDrawingCommand.apply() should update them (via loadDrawingSource).
    useAppStore.setState({ activeDrawingSourcePartId: 'some-id', activeDrawingSourceFingerprint: 'some-fp' } as never);
    const fakeDoc = { id: 'd1', name: 'D', units: 'mm', source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {}, sheets: [], activeSheetId: 's1' };
    const patch = drawingDocState(fakeDoc as never);
    // The patch object does NOT contain source slot keys — Zustand merges, so
    // existing values in the store are preserved.
    expect((patch as unknown as { activeDrawingSourcePartId?: unknown }).activeDrawingSourcePartId).toBeUndefined();
    expect((patch as unknown as { activeDrawingSourceFingerprint?: unknown }).activeDrawingSourceFingerprint).toBeUndefined();
  });
});

describe('activeDrawingSourceComponents store slot', () => {
  it('activeDrawingSourceComponents defaults to null', () => {
    const state = useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown };
    expect('activeDrawingSourceComponents' in state).toBe(true);
    expect(state.activeDrawingSourceComponents).toBeNull();
  });

  it('activeDrawingSourceComponents can be set and read', () => {
    const comps: AssemblyComponentInput[] = [
      { partId: 'pid-1', pose: { translation: { x: 1, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ];
    useAppStore.setState({ activeDrawingSourceComponents: comps } as never);
    const s = useAppStore.getState() as unknown as { activeDrawingSourceComponents: AssemblyComponentInput[] | null };
    expect(s.activeDrawingSourceComponents).toEqual(comps);
  });

  it('drawingDocState does NOT reset activeDrawingSourceComponents', () => {
    const comps: AssemblyComponentInput[] = [
      { partId: 'pid-asm', pose: { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ];
    useAppStore.setState({ activeDrawingSourceComponents: comps } as never);

    const fakeDoc = {
      id: 'drw-1', name: 'D', units: 'mm', source: { partPath: 'a.ziasm', sourceKind: 'assembly' },
      properties: {}, sheets: [], activeSheetId: 's1',
    };
    const patch = drawingDocState(fakeDoc as never);
    // patch must NOT contain activeDrawingSourceComponents — Zustand merges, so the
    // stored value is preserved across all drawing edit operations.
    expect((patch as unknown as { activeDrawingSourceComponents?: unknown }).activeDrawingSourceComponents).toBeUndefined();
  });
});
