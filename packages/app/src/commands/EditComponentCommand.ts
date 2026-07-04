import type { Command } from './Command';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type EditComponentOpts = {
  id: string;
  patch: Partial<ComponentInstance>;
};

export class EditComponentCommand implements Command {
  readonly name = 'EditComponent';
  private prior: ComponentInstance | null = null;
  constructor(private opts: EditComponentOpts) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    const asm = s.activeAssembly;
    const c = asm?.components.find((x) => x.id === this.opts.id);
    if (!asm || !c) throw new Error(`EditComponent: component ${this.opts.id} not found`);
    this.prior = { ...c };

    const patch = this.opts.patch;
    const touchesPose = 'position' in patch || 'rotation' in patch;
    if (touchesPose && 'pose' in c) {
      // Stale-pose foot-gun: a manual position/rotation edit must invalidate
      // any stored pose (true key deletion, not pose:undefined — the type is
      // exactOptionalPropertyTypes) so componentLocalPose falls back to the
      // freshly-edited rotation-derived quaternion. The store's
      // updateComponent does a shallow {...c, ...patch} merge and cannot
      // delete keys, so the next component is built here and written
      // directly through the assembly document.
      const { pose: _pose, ...rest } = c;
      const nextComponent = { ...rest, ...patch } as ComponentInstance;
      const next: AssemblyDocument = {
        ...asm,
        components: asm.components.map((x) => (x.id === this.opts.id ? nextComponent : x)),
      };
      useAppStore.setState({
        activeDocument: { kind: 'assembly', document: next },
        activeAssembly: next,
        solverDirty: true,
      });
    } else {
      s.updateComponent(this.opts.id, patch);
    }
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().updateComponent(this.opts.id, this.prior);
    this.prior = null;
  }
}
