// packages/app/src/store/__tests__/activeDrawingSourcePartId.spec.ts
import { describe, it, expect } from 'vitest';
import { useAppStore } from '../useAppStore';
import { drawingDocState } from '../drawingDocState';

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
