import type { EdgeName, FaceName } from '@zilventor/shared';

export type PickMode = 'face' | 'axis' | 'point' | 'edge' | 'circularEdge';

export type AssemblyPickHit =
  | { kind: 'face';  role: string; hit: { componentId: string; face: FaceName } }
  | { kind: 'edge';  role: string; hit: { componentId: string; edge: EdgeName } }
  | { kind: 'axis';  role: string; hit: { componentId: string; source: 'edge'; edge: EdgeName } | { componentId: string; source: 'cylindricalFace'; face: FaceName } }
  | { kind: 'point'; role: string; hit: { componentId: string; vertex: { edge: EdgeName; end: 'start' | 'end' } } }
  | { kind: 'circularEdge'; role: string; hit: { componentId: string; edge: EdgeName } };

export class AssemblyRefPickController {
  private active: { mode: PickMode; role: string; cb: (h: AssemblyPickHit) => void } | null = null;

  activate(mode: PickMode, role: string, cb: (h: AssemblyPickHit) => void): void {
    this.active = { mode, role, cb };
  }
  deactivate(): void { this.active = null; }
  isActive(): boolean { return this.active !== null; }
  getMode(): PickMode | null { return this.active?.mode ?? null; }

  handleFaceHit(componentId: string, face: FaceName): void {
    if (!this.active || this.active.mode !== 'face') return;
    this.active.cb({ kind: 'face', role: this.active.role, hit: { componentId, face } });
    this.active = null;
  }
  handleEdgeHit(componentId: string, edge: EdgeName, isCircular: boolean): void {
    if (!this.active) return;
    if (this.active.mode === 'edge') {
      this.active.cb({ kind: 'edge', role: this.active.role, hit: { componentId, edge } });
      this.active = null; return;
    }
    if (this.active.mode === 'axis') {
      this.active.cb({ kind: 'axis', role: this.active.role, hit: { componentId, source: 'edge', edge } });
      this.active = null; return;
    }
    if (this.active.mode === 'circularEdge' && isCircular) {
      this.active.cb({ kind: 'circularEdge', role: this.active.role, hit: { componentId, edge } });
      this.active = null;
    }
  }
  handleCylindricalFaceHit(componentId: string, face: FaceName): void {
    if (!this.active || this.active.mode !== 'axis') return;
    this.active.cb({ kind: 'axis', role: this.active.role, hit: { componentId, source: 'cylindricalFace', face } });
    this.active = null;
  }
  handleVertexHit(componentId: string, edge: EdgeName, end: 'start' | 'end'): void {
    if (!this.active || this.active.mode !== 'point') return;
    this.active.cb({ kind: 'point', role: this.active.role, hit: { componentId, vertex: { edge, end } } });
    this.active = null;
  }
}
