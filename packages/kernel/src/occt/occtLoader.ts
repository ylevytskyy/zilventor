// Dynamic entry-point selection for opencascade.js.
//
// Node (integration tests, CLI): use `opencascade.js/dist/node.js` which
// patches `__dirname` so the Emscripten runtime can fetch its .wasm from
// the filesystem.
//
// Browser / Web Worker (Vite build): we can't use the package's default
// browser entry because it does `import ocFullWasm from "...full.wasm"`,
// which Vite's esbuild pipeline rejects (ESM Wasm proposal isn't
// supported). Instead we import the Emscripten glue JS directly and feed
// it a `?url`-imported wasm via Emscripten's `locateFile` hook — Vite
// emits the .wasm as a static asset and returns its fetch URL.

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

  type EmscriptenFactory = new (opts: { locateFile?: (p: string) => string }) => Promise<OcctInstance>;
  const mainModJs = (await import(/* @vite-ignore */ 'opencascade.js/dist/opencascade.full.js')) as unknown as { default: EmscriptenFactory };
  // `?url` needs a literal specifier so Vite's static analyser picks it up
  // and emits the wasm as an asset. TS has no declaration for the `?url`
  // virtual module, hence the `@ts-expect-error`.
  // @ts-expect-error Vite `?url` import has no TS declaration
  const wasmUrlMod: { default: string } = await import('opencascade.js/dist/opencascade.full.wasm?url');
  const mainJS = mainModJs.default;
  const wasmUrl = wasmUrlMod.default;
  return new mainJS({
    locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p)
  });
}
