import { useSyncExternalStore, useRef } from 'react';
import type { ParameterRegistry } from './ParameterRegistry';

export function useParameterValues(registry: ParameterRegistry): Map<string, number> {
  const cacheRef = useRef<Map<string, number>>(new Map());

  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => {
      const prev = cacheRef.current;
      const all = registry.getAll();
      // Check if anything changed vs the cached map
      if (prev.size === all.length && all.every((p) => prev.get(p.name) === p.value)) {
        return prev;
      }
      const next = new Map<string, number>();
      for (const p of all) next.set(p.name, p.value);
      cacheRef.current = next;
      return next;
    }
  );
}
