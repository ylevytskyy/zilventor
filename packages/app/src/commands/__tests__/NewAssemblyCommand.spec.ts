import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { NewAssemblyCommand } from '../NewAssemblyCommand';

describe('NewAssemblyCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('sets activeDocument to a fresh empty assembly', () => {
    NewAssemblyCommand({ name: 'untitled-assembly' });
    const s = useAppStore.getState();
    expect(s.activeDocument?.kind).toBe('assembly');
    expect(s.activeAssembly?.name).toBe('untitled-assembly');
    expect(s.activeAssembly?.components).toEqual([]);
  });
});
