// The default entry (`opencascade.js`) imports the `.wasm` file via an ESM
// URL import, which works in bundlers/browsers but not in plain Node.
// The package ships a Node-specific entry that patches __dirname and loads
// the WASM from disk. Prefer it when running under Node (tests, CLI tools);
// the browser/worker adapter can import the default entry directly.
import initOpenCascade from 'opencascade.js/dist/node.js';

export type OcctInstance = Awaited<ReturnType<typeof initOpenCascade>>;

let cached: Promise<OcctInstance> | null = null;

export function loadOcct(): Promise<OcctInstance> {
  cached ??= initOpenCascade();
  return cached;
}
