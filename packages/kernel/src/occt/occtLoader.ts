// Dynamic entry-point selection for opencascade.js.
//
// Node (integration tests, CLI): use `opencascade.js/dist/node.js` which
// patches `__dirname` so the Emscripten runtime can fetch its .wasm from
// the filesystem.
//
// Browser / Web Worker — production build (Step 3b path):
//   opencascade.full.js and opencascade.full.wasm are served as static public
//   assets at /occt/ (copied by packages/app/scripts/copy-occt.mjs at prebuild).
//   We load the Emscripten glue via a runtime URL import rather than letting
//   Rollup bundle it: Rollup cannot handle opencascade.full.js because it uses
//   raw `.wasm` ESM-proposal imports and Node built-ins (`path`, `url`,
//   `__dirname`). The `/* @vite-ignore */` comments suppress Vite's resolver
//   warnings; in production the file is fetched by the browser at runtime,
//   never processed by Rollup.
//
// Browser / Web Worker — dev server:
//   Vite dev server sees the `@vite-ignore` on the /occt/ import and passes it
//   through. The browser fetches it from Vite's static-file serving of the
//   public/ directory at the same /occt/opencascade.full.js URL. This keeps
//   dev and prod consistent.

export type OcctInstance = Awaited<ReturnType<typeof import('opencascade.js')['default']>>;

let cached: Promise<OcctInstance> | null = null;

export function loadOcct(): Promise<OcctInstance> {
  cached ??= loadImpl();
  return cached;
}

async function loadImpl(): Promise<OcctInstance> {
  const isNode =
    typeof process !== 'undefined' &&
    !!(process as { versions?: { node?: string } }).versions?.node;

  if (isNode) {
    const mod = (await import(/* @vite-ignore */ 'opencascade.js/dist/node.js')) as {
      default: () => Promise<OcctInstance>;
    };
    return mod.default();
  }

  // Browser / Web Worker path.
  // PRODUCTION: opencascade.full.js is a public static asset at /occt/.
  // DEV: Vite serves public/ at the root, so /occt/opencascade.full.js resolves too.
  // The @vite-ignore prevents Vite/Rollup from trying to statically analyse or
  // bundle an Emscripten module that uses Node built-ins and raw wasm imports.
  type EmscriptenFactory = new (opts: { locateFile?: (p: string) => string }) => Promise<OcctInstance>;
  // @ts-ignore — /occt/opencascade.full.js is a public static asset served at
  // runtime; TypeScript has no type declarations for it. The `@vite-ignore`
  // prevents Rollup from trying to statically resolve or bundle this path.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  const mainModJs = (await import(/* @vite-ignore */ '/occt/opencascade.full.js')) as unknown as { default: EmscriptenFactory };
  const mainJS = mainModJs.default;
  return new mainJS({
    locateFile: (p: string) => (p.endsWith('.wasm') ? '/occt/opencascade.full.wasm' : p)
  });
}
