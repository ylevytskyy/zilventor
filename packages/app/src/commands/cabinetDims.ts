import type { AssemblyDocument } from '@zilventor/shared';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';

type OpfsReader = {
  read(p: string): Promise<Uint8Array>;
};

/**
 * Derives {width, height, depth, Tc, toekickHeight} from the unpacked cabinet .ziasm.
 *
 * Strategy (mirrors how buildBaseCabinet lays out panels, baseCabinet.ts:29-77):
 * - leftSide component: position.x=0, PanelFeature.length=H, .width=D, .thickness=Tc
 * - rightSide component: position.x = W - Tc  →  W = position.x + Tc
 * - bottom component: position.z = toekickHeight
 *
 * All returned values MUST be strictly positive. If derivation fails, throws.
 */
export async function deriveCabinetDims(
  cab: AssemblyDocument,
  opfs: Pick<OpfsReader, 'read'>,
): Promise<{ width: number; height: number; depth: number; Tc: number; toekickHeight: number }> {
  const leftComp = cab.components.find((c) => c.role === 'leftSide');
  const rightComp = cab.components.find((c) => c.role === 'rightSide');
  const bottomComp = cab.components.find((c) => c.role === 'bottom');

  if (!leftComp) {
    throw new Error(
      'AddDoorCommand: cabinet has no leftSide component — cannot derive cabinet dims (width/height/depth)',
    );
  }

  // Read the left-side PanelFeature to get H, D, Tc.
  const leftProject = await unpackProject(await opfs.read(leftComp.partPath));
  const leftDoc = (leftProject.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
  const leftPanel = (leftDoc.featureTree ?? []).find((f) => f.kind === 'panel') as
    | { length: { value: number }; width: { value: number }; thickness: { value: number } }
    | undefined;
  if (!leftPanel) {
    throw new Error('AddDoorCommand: leftSide panel has no PanelFeature — cannot derive cabinet dims');
  }

  const H = leftPanel.length.value;   // side panel native length = cabinet height
  const D = leftPanel.width.value;    // side panel native width  = cabinet depth
  const Tc = leftPanel.thickness.value;

  // Width: rightSide position.x + Tc  (from buildBaseCabinet: rightSide.position = {x: W - Tc, ...})
  const W = rightComp ? rightComp.position.x + Tc : NaN;

  // Toekick height: bottom panel position.z  (from buildBaseCabinet: bottom.position = {z: tkH, ...})
  const tkH = bottomComp ? bottomComp.position.z : 0;

  const derived = { width: W, height: H, depth: D, Tc, toekickHeight: tkH };

  // ADDENDUM §4: assert all strictly positive before passing to doorMath.
  for (const [k, v] of Object.entries(derived)) {
    if (typeof v !== 'number' || isNaN(v)) {
      throw new Error(
        `AddDoorCommand: derived cabinet dims not all positive — ${k}=${v}`,
      );
    }
  }
  if (derived.width <= 0 || derived.height <= 0 || derived.depth <= 0 || derived.Tc <= 0) {
    throw new Error(
      `AddDoorCommand: derived cabinet dims must be strictly positive — ` +
      `width=${derived.width} height=${derived.height} depth=${derived.depth} Tc=${derived.Tc}`,
    );
  }

  return derived;
}
