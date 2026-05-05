import '@testing-library/jest-dom';

// Node 25+ exposes a broken `globalThis.localStorage` stub (an empty object
// whose `getItem`/`setItem` are undefined unless `--localstorage-file=PATH`
// is passed) and jsdom under vitest does NOT override it. Without this shim,
// every test that imports a module reading `localStorage` at evaluation time
// (e.g. zustand stores) crashes. Provide a working in-memory implementation.
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
