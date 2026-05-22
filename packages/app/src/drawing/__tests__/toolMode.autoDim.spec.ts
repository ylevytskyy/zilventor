// packages/app/src/drawing/__tests__/toolMode.autoDim.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useToolModeStore, type ToolMode } from '../toolMode';

describe('useToolModeStore — autoDim mode', () => {
  beforeEach(() => useToolModeStore.getState().reset());

  it('HS-TM-1: setMode("autoDim") stores autoDim and getState().mode returns it', () => {
    useToolModeStore.getState().setMode('autoDim');
    expect(useToolModeStore.getState().mode).toBe('autoDim');
  });

  it('HS-TM-1b: "autoDim" is a valid ToolMode (exhaustive switch compiles and matches)', () => {
    // Use getState() so TypeScript sees ToolMode (the full union), not the literal 'autoDim'.
    useToolModeStore.getState().setMode('autoDim');
    const mode: ToolMode = useToolModeStore.getState().mode;
    let matched = false;
    switch (mode) {
      case 'idle': break;
      case 'placeBase': break;
      case 'placeProjected': break;
      case 'placeIso': break;
      case 'addLinearH': break;
      case 'addLinearV': break;
      case 'addAligned': break;
      case 'addRadial': break;
      case 'addDiametric': break;
      case 'addCenterline': break;
      case 'addCenterMark': break;
      case 'addLeader': break;
      case 'addBalloon': break;
      case 'section': break;
      case 'detail': break;
      case 'break': break;
      case 'autoDim': matched = true; break;
    }
    expect(matched).toBe(true);
  });
});
