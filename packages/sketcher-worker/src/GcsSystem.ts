import type { GcsWrapper } from '@salusoft89/planegcs';
import type { SketchPrimitive, SketchConstraint } from '@zilventor/shared';
import type {
  DofStatus,
  LoadSketchResult,
} from './types';

// planegcs wire-format primitives (matching SketchPrimitive/SketchGeometry interfaces)
type PlanegcsPoint = { id: string; type: 'point'; x: number; y: number; fixed: boolean };
type PlanegcsLine  = { id: string; type: 'line'; p1_id: string; p2_id: string };
type PlanegcsCircle = { id: string; type: 'circle'; c_id: string; radius: number };
type PlanegcsArc   = {
  id: string; type: 'arc';
  c_id: string; start_id: string; end_id: string; radius: number;
  start_angle: number; end_angle: number;
};
// planegcs implicit constraint wire types
type PlanegcsHorizL = { id: string; type: 'horizontal_l'; l_id: string };
type PlanegcsVertL  = { id: string; type: 'vertical_l';   l_id: string };

type PlanegcsPrimitive =
  | PlanegcsPoint | PlanegcsLine | PlanegcsCircle | PlanegcsArc
  | PlanegcsHorizL | PlanegcsVertL;

type Decomposition = { pointIds: Record<string, string>; primitiveId: string };

export class GcsSystem {
  private loaded = false;
  private decomp = new Map<string, Decomposition>();
  private domainPrimitives = new Map<string, SketchPrimitive>();
  private domainConstraints = new Map<string, SketchConstraint>();

  constructor(private gcs: InstanceType<typeof GcsWrapper>) {}

  async loadSketch(args: {
    primitives: SketchPrimitive[];
    constraints: SketchConstraint[];
  }): Promise<LoadSketchResult> {
    if (this.loaded) throw new Error('GcsSystem already loaded — call unloadSketch first');
    this.loaded = true;

    const gcsPrims: PlanegcsPrimitive[] = [];

    for (const p of args.primitives) {
      this.domainPrimitives.set(p.id, p);
      this.pushPrimitiveDecomposition(p, gcsPrims);
    }

    // push_primitives_and_params accepts SketchPrimitive (geometry + constraints) and SketchParam
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.gcs as any).push_primitives_and_params(gcsPrims);

    for (const c of args.constraints) this.domainConstraints.set(c.id, c);

    this.gcs.solve();
    this.gcs.apply_solution();

    return { dof: this.readDof(), warnings: [] };
  }

  async unloadSketch(): Promise<void> {
    if (!this.loaded) return;
    this.loaded = false;
    this.decomp.clear();
    this.domainPrimitives.clear();
    this.domainConstraints.clear();
    this.gcs.destroy_gcs_module();
  }

  private pushPrimitiveDecomposition(p: SketchPrimitive, into: PlanegcsPrimitive[]): void {
    const pId = (suffix: string) => `${p.id}#${suffix}`;

    switch (p.kind) {
      case 'line': {
        const s = pId('start'), e = pId('end');
        into.push({ id: s, type: 'point', x: p.x1, y: p.y1, fixed: false });
        into.push({ id: e, type: 'point', x: p.x2, y: p.y2, fixed: false });
        into.push({ id: p.id, type: 'line', p1_id: s, p2_id: e });
        this.decomp.set(p.id, { pointIds: { start: s, end: e }, primitiveId: p.id });
        break;
      }
      case 'circle': {
        const c = pId('center');
        into.push({ id: c, type: 'point', x: p.cx, y: p.cy, fixed: false });
        into.push({ id: p.id, type: 'circle', c_id: c, radius: p.r });
        this.decomp.set(p.id, { pointIds: { center: c }, primitiveId: p.id });
        break;
      }
      case 'arc': {
        const c = pId('center'), s = pId('start'), e = pId('end');
        const sx = p.cx + p.r * Math.cos(p.startAngle);
        const sy = p.cy + p.r * Math.sin(p.startAngle);
        const ex = p.cx + p.r * Math.cos(p.endAngle);
        const ey = p.cy + p.r * Math.sin(p.endAngle);
        into.push({ id: c, type: 'point', x: p.cx, y: p.cy, fixed: false });
        into.push({ id: s, type: 'point', x: sx, y: sy, fixed: false });
        into.push({ id: e, type: 'point', x: ex, y: ey, fixed: false });
        into.push({
          id: p.id, type: 'arc',
          c_id: c, start_id: s, end_id: e,
          radius: p.r,
          start_angle: p.startAngle,
          end_angle: p.endAngle,
        });
        this.decomp.set(p.id, { pointIds: { center: c, start: s, end: e }, primitiveId: p.id });
        break;
      }
      case 'rectangle': {
        const bl = pId('bl'), br = pId('br'), tr = pId('tr'), tl = pId('tl');
        into.push({ id: bl, type: 'point', x: p.x,       y: p.y,       fixed: false });
        into.push({ id: br, type: 'point', x: p.x + p.w, y: p.y,       fixed: false });
        into.push({ id: tr, type: 'point', x: p.x + p.w, y: p.y + p.h, fixed: false });
        into.push({ id: tl, type: 'point', x: p.x,       y: p.y + p.h, fixed: false });
        const lBottom = `${p.id}#bottom`;
        const lRight  = `${p.id}#right`;
        const lTop    = `${p.id}#top`;
        const lLeft   = `${p.id}#left`;
        into.push({ id: lBottom, type: 'line', p1_id: bl, p2_id: br });
        into.push({ id: lRight,  type: 'line', p1_id: br, p2_id: tr });
        into.push({ id: lTop,    type: 'line', p1_id: tl, p2_id: tr });
        into.push({ id: lLeft,   type: 'line', p1_id: bl, p2_id: tl });
        // Rectangle-implicit orthogonality constraints — included in push_primitives_and_params
        into.push({ id: `${p.id}#_h_bottom`, type: 'horizontal_l', l_id: lBottom });
        into.push({ id: `${p.id}#_h_top`,    type: 'horizontal_l', l_id: lTop });
        into.push({ id: `${p.id}#_v_left`,   type: 'vertical_l',   l_id: lLeft });
        into.push({ id: `${p.id}#_v_right`,  type: 'vertical_l',   l_id: lRight });
        this.decomp.set(p.id, {
          pointIds: { bl, br, tr, tl, bottom: lBottom, right: lRight, top: lTop, left: lLeft },
          primitiveId: p.id,
        });
        break;
      }
      case 'spline': {
        const pointIds: Record<string, string> = {};
        for (let i = 0; i < p.controlPoints.length; i++) {
          const cp = p.controlPoints[i]!;
          const id = pId(`cp${i}`);
          into.push({ id, type: 'point', x: cp.x, y: cp.y, fixed: false });
          pointIds[`cp${i}`] = id;
        }
        this.decomp.set(p.id, { pointIds, primitiveId: p.id });
        break;
      }
    }
  }

  private readDof(): DofStatus {
    // GcsWrapper.gcs is the public GcsSystem (WASM) which has dof()
    const n: number = this.gcs.gcs.dof();
    if (n === 0) return { count: 0, state: 'fully' };
    if (n < 0)  return { count: Math.abs(n), state: 'over' };
    return { count: n, state: 'under' };
  }

  // Task 8 adds: addConstraint, removeConstraint
  // Task 9 adds: beginDrag, dragTo, endDrag
  // Task 10 adds: redundant/conflict detection
}
