import i18n from '../i18n';

/**
 * SolidWorks native files (.SLDPRT / .SLDASM) are proprietary OLE compound
 * documents wrapping Parasolid geometry. The OCCT WASM kernel cannot read them
 * and no robust open-source reader exists for the browser. Rather than fail with
 * a cryptic archive error, File → Open detects these files and shows guidance to
 * export a STEP file (which the app imports robustly).
 */

/** True when `name` ends in a SolidWorks native part/assembly extension. */
export function isSolidWorksNativeFile(name: string): boolean {
  return /\.(sldprt|sldasm)$/i.test(name);
}

/** User-facing message shown when a SolidWorks native file is opened. */
export function getSolidWorksGuidance(): string {
  return i18n.t('dialog.solidWorksGuidance');
}

/**
 * @deprecated Use `getSolidWorksGuidance()` instead — the string is now
 * translated at call time.  This re-export exists only until the `shell/tabs`
 * agent migrates `FileTab.tsx`.
 */
export const SOLIDWORKS_GUIDANCE: string = getSolidWorksGuidance();
