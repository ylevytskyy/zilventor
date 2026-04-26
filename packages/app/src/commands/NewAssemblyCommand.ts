import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type NewAssemblyOpts = { name: string };

export function NewAssemblyCommand(opts: NewAssemblyOpts): void {
  const doc: AssemblyDocument = {
    id: `A${Date.now()}`,
    name: opts.name,
    units: 'mm',
    parameters: {},
    components: [],
    constraints: [],
    groundedComponentIds: [],
    colors: {},
    bomItemNumbers: {},
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}
