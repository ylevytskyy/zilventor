import { describe, it, expect, beforeEach } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { OpenProjectFileCommand } from '../OpenProjectFileCommand';

describe('OpenProjectFileCommand', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activeAssembly: null,
      activePart: null,
      subAssemblyDocs: {},
      statusMessage: '',
    } as any);
  });

  const subDoc: AssemblyDocument = {
    id: 'D1', name: 'drawer', units: 'mm', parameters: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, colorOverrides: {},
  };

  it('sets activeDocument to the cached sub-asm and returns true', () => {
    useAppStore.setState({
      subAssemblyDocs: { 'sub/drawer.ziasm': subDoc },
    } as any);
    const ok = OpenProjectFileCommand('sub/drawer.ziasm');
    expect(ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.activeDocument).toEqual({ kind: 'assembly', document: subDoc });
    expect(s.activeAssembly).toEqual(subDoc);
    expect(s.statusMessage).toMatch(/Opened sub\/drawer\.ziasm/);
  });

  it('returns false and sets a status when the partPath is not loaded', () => {
    const ok = OpenProjectFileCommand('sub/missing.ziasm');
    expect(ok).toBe(false);
    expect(useAppStore.getState().activeDocument).toBeNull();
    expect(useAppStore.getState().statusMessage).toMatch(/not loaded/);
  });

  it('refuses to open a .zipt path (parts cannot open in standalone via this command)', () => {
    const ok = OpenProjectFileCommand('parts/leg.zipt');
    expect(ok).toBe(false);
    expect(useAppStore.getState().activeDocument).toBeNull();
    expect(useAppStore.getState().statusMessage).toMatch(/only \.ziasm/);
  });
});
