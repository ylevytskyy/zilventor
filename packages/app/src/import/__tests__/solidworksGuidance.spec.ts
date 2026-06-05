import { describe, it, expect } from 'vitest';
import { isSolidWorksNativeFile, SOLIDWORKS_GUIDANCE } from '../solidworksGuidance';

describe('isSolidWorksNativeFile', () => {
  it('matches .sldprt and .sldasm', () => {
    expect(isSolidWorksNativeFile('bracket.sldprt')).toBe(true);
    expect(isSolidWorksNativeFile('chassis.sldasm')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSolidWorksNativeFile('BRACKET.SLDPRT')).toBe(true);
    expect(isSolidWorksNativeFile('Chassis.SldAsm')).toBe(true);
  });

  it('matches basename with path or spaces', () => {
    expect(isSolidWorksNativeFile('Shelving Unit/side panel.SLDPRT')).toBe(true);
  });

  it('rejects formats the app already handles', () => {
    expect(isSolidWorksNativeFile('model.step')).toBe(false);
    expect(isSolidWorksNativeFile('model.stp')).toBe(false);
    expect(isSolidWorksNativeFile('part.zipt')).toBe(false);
    expect(isSolidWorksNativeFile('asm.ziasm')).toBe(false);
    expect(isSolidWorksNativeFile('bundle.zip')).toBe(false);
  });

  it('rejects names without the extension', () => {
    expect(isSolidWorksNativeFile('sldprt')).toBe(false);
    expect(isSolidWorksNativeFile('my.sldprt.backup')).toBe(false);
    expect(isSolidWorksNativeFile('')).toBe(false);
  });
});

describe('SOLIDWORKS_GUIDANCE', () => {
  it('tells the user to export STEP', () => {
    expect(SOLIDWORKS_GUIDANCE).toMatch(/STEP/);
    expect(SOLIDWORKS_GUIDANCE.toLowerCase()).toContain('save as');
  });
});
