import { useSyncExternalStore } from 'react';
import type { ParameterRegistry } from './ParameterRegistry';

export function useParameterValues(registry: ParameterRegistry): Map<string, number> {
  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => {
      const m = new Map<string, number>();
      for (const p of registry.getAll()) m.set(p.name, p.value);
      return m;
    }
  );
}
