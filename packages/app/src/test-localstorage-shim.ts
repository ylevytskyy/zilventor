// Node 25+ exposes a broken `globalThis.localStorage` stub (an empty object
// whose `getItem`/`setItem` are undefined unless `--localstorage-file=PATH`
// is passed) and jsdom under vitest does NOT override it. Without this shim,
// every test that imports a module reading `localStorage` at evaluation time
// (e.g. zustand stores, or i18next's language detector) crashes. Provide a
// working in-memory implementation.
//
// This lives in its OWN module so that `test-setup.ts` can import it BEFORE
// importing `./i18n` (whose LanguageDetector reads localStorage at init):
// static ES imports evaluate in source order, so the shim is installed before
// i18n initializes. Inlining the shim as setup-file body code would NOT work —
// import statements hoist above body code, so `import './i18n'` would run first.
class TestStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new TestStorage(),
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: new TestStorage(),
  writable: true,
  configurable: true,
});
