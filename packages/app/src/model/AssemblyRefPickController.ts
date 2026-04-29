import type { ComponentPath, EdgeName, FaceName } from '@zilventor/shared';

export type PickMode = 'face' | 'axis' | 'point' | 'edge' | 'circularEdge';

/**
 * T30 (4d Phase 9): hits now carry `componentPath: ComponentPath` instead of
 * `componentId: string`. Sub-assembly leaves and top-level components are
 * indistinguishable to the viewport raycast layer; ComponentPath uniquely
 * identifies any leaf in the recursive component tree.
 */
export type AssemblyPickHit =
  | { kind: 'face';  role: string; hit: { componentPath: ComponentPath; face: FaceName } }
  | { kind: 'edge';  role: string; hit: { componentPath: ComponentPath; edge: EdgeName } }
  | { kind: 'axis';  role: string; hit: { componentPath: ComponentPath; source: 'edge'; edge: EdgeName } | { componentPath: ComponentPath; source: 'cylindricalFace'; face: FaceName } }
  | { kind: 'point'; role: string; hit: { componentPath: ComponentPath; vertex: { edge: EdgeName; end: 'start' | 'end' } } }
  | { kind: 'circularEdge'; role: string; hit: { componentPath: ComponentPath; edge: EdgeName } };

export class AssemblyRefPickController {
  private active: { mode: PickMode; role: string; cb: (h: AssemblyPickHit) => void } | null = null;

  activate(mode: PickMode, role: string, cb: (h: AssemblyPickHit) => void): void {
    this.active = { mode, role, cb };
  }
  deactivate(): void { this.active = null; }
  isActive(): boolean { return this.active !== null; }
  getMode(): PickMode | null { return this.active?.mode ?? null; }

  handleFaceHit(componentPath: ComponentPath, face: FaceName): void {
    if (!this.active || this.active.mode !== 'face') return;
    this.active.cb({ kind: 'face', role: this.active.role, hit: { componentPath, face } });
    this.active = null;
  }
  handleEdgeHit(componentPath: ComponentPath, edge: EdgeName, isCircular: boolean): void {
    if (!this.active) return;
    if (this.active.mode === 'edge') {
      this.active.cb({ kind: 'edge', role: this.active.role, hit: { componentPath, edge } });
      this.active = null; return;
    }
    if (this.active.mode === 'axis') {
      this.active.cb({ kind: 'axis', role: this.active.role, hit: { componentPath, source: 'edge', edge } });
      this.active = null; return;
    }
    if (this.active.mode === 'circularEdge' && isCircular) {
      this.active.cb({ kind: 'circularEdge', role: this.active.role, hit: { componentPath, edge } });
      this.active = null;
    }
  }
  handleCylindricalFaceHit(componentPath: ComponentPath, face: FaceName): void {
    if (!this.active || this.active.mode !== 'axis') return;
    this.active.cb({ kind: 'axis', role: this.active.role, hit: { componentPath, source: 'cylindricalFace', face } });
    this.active = null;
  }
  handleVertexHit(componentPath: ComponentPath, edge: EdgeName, end: 'start' | 'end'): void {
    if (!this.active || this.active.mode !== 'point') return;
    this.active.cb({ kind: 'point', role: this.active.role, hit: { componentPath, vertex: { edge, end } } });
    this.active = null;
  }
}
