// Minimal browser shim for Node's `events` module. Provides a CommonJS-style
// default export compatible with `require('events')` and the named
// EventEmitter import used by `events-universal`/`streamx` (the tar-stream
// dependency chain).
//
// We intentionally implement the small surface area that streamx needs:
// on/off/once/emit/removeAllListeners. If a consumer needs more, extend
// here rather than pulling in a full Node polyfill.

export class EventEmitter {
  private readonly _listeners: Map<string | symbol, Array<(...args: unknown[]) => void>> =
    new Map();

  on(event: string | symbol, fn: (...args: unknown[]) => void): this {
    const arr = this._listeners.get(event) ?? [];
    arr.push(fn);
    this._listeners.set(event, arr);
    return this;
  }

  addListener(event: string | symbol, fn: (...args: unknown[]) => void): this {
    return this.on(event, fn);
  }

  once(event: string | symbol, fn: (...args: unknown[]) => void): this {
    const wrap = (...args: unknown[]): void => {
      this.off(event, wrap);
      fn(...args);
    };
    return this.on(event, wrap);
  }

  off(event: string | symbol, fn: (...args: unknown[]) => void): this {
    const arr = this._listeners.get(event);
    if (!arr) return this;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
    if (arr.length === 0) this._listeners.delete(event);
    return this;
  }

  removeListener(event: string | symbol, fn: (...args: unknown[]) => void): this {
    return this.off(event, fn);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this._listeners.clear();
    else this._listeners.delete(event);
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) return false;
    for (const fn of arr.slice()) fn(...args);
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this._listeners.get(event)?.length ?? 0;
  }

  setMaxListeners(_n: number): this {
    return this;
  }
}

// CommonJS consumers reach for both `require('events')` (whole module)
// and `require('events').EventEmitter`. The default export covers the
// former; the named export above covers the latter.
export default { EventEmitter };
