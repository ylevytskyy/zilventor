import type { GcsWrapper } from '@salusoft89/planegcs';
import type { SketchPrimitive, SketchConstraint, PointRef, DimensionConstraint } from '@zilventor/shared';
import type {
  DofStatus,
  LoadSketchResult,
  AddConstraintResult,
  AddDimensionResult,
  PrimitiveCoordsDiff,
  DragSolveResult,
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
  /** Resolved numeric values for dim-* constraints, kept in sync with the
   *  stored constraint's `value` field (which may be `{kind:'param'}`). Used by
   *  rebuildGcs so param-kind dimensions replay with the current resolved value. */
  private dimensionResolvedValue = new Map<string, number>();
  /** Frozen copy of primitives at load time — used as baseline for drag finalCoords. */
  private originalPrimitives = new Map<string, SketchPrimitive>();

  private dragRef: PointRef | null = null;
  private dragLockId: string | null = null;
  private dragAnchorId: string | null = null;

  constructor(private gcs: InstanceType<typeof GcsWrapper>) {}

  async loadSketch(args: {
    primitives: SketchPrimitive[];
    constraints: SketchConstraint[];
    /** Pre-resolved numeric values keyed by dim constraint id, for any constraint
     *  whose `value.kind === 'param'`. Literal-value dims ignore this map. */
    dimensionResolvedValues?: Record<string, number>;
  }): Promise<LoadSketchResult> {
    if (this.loaded) throw new Error('GcsSystem already loaded — call unloadSketch first');
    this.loaded = true;

    const gcsPrims: PlanegcsPrimitive[] = [];

    for (const p of args.primitives) {
      this.domainPrimitives.set(p.id, p);
      this.originalPrimitives.set(p.id, p);
      this.pushPrimitiveDecomposition(p, gcsPrims);
    }

    // push_primitives_and_params accepts SketchPrimitive (geometry + constraints) and SketchParam
    this.gcs.push_primitives_and_params(gcsPrims as never);

    for (const c of args.constraints) {
      this.domainConstraints.set(c.id, c);
      if (isDimension(c)) {
        const resolved = resolveDimensionValue(c, args.dimensionResolvedValues);
        this.dimensionResolvedValue.set(c.id, resolved);
        const gcsConstraints = this.translateDimensionConstraint(c, resolved);
        if (gcsConstraints !== null) {
          for (const gc of gcsConstraints) this.gcs.push_primitive(gc as never);
        }
      } else {
        const gcsConstraints = this.translateConstraint(c);
        if (gcsConstraints !== null) {
          for (const gc of gcsConstraints) this.gcs.push_primitive(gc as never);
        }
      }
    }

    this.gcs.solve();
    this.gcs.apply_solution();

    return { dof: this.readDof(), warnings: [] };
  }

  async unloadSketch(): Promise<void> {
    if (!this.loaded) return;
    this.loaded = false;
    this.decomp.clear();
    this.domainPrimitives.clear();
    this.originalPrimitives.clear();
    this.domainConstraints.clear();
    this.dimensionResolvedValue.clear();
    this.dragRef = null;
    this.dragLockId = null;
    this.dragAnchorId = null;
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

  async addConstraint(c: SketchConstraint): Promise<AddConstraintResult> {
    this.requireLoaded();
    const gcsConstraints = this.translateConstraint(c);
    if (gcsConstraints === null) {
      return { ok: false, reason: 'conflict', offendingConstraintIds: [c.id] };
    }
    for (const gc of gcsConstraints) this.gcs.push_primitive(gc as never);
    this.gcs.solve();
    this.gcs.apply_solution();

    if (this.gcs.has_gcs_conflicting_constraints()) {
      const offendingConstraintIds = this.gcs.get_gcs_conflicting_constraints();
      this.rebuildGcs();
      return { ok: false, reason: 'conflict', offendingConstraintIds };
    }
    if (this.gcs.has_gcs_redundant_constraints()) {
      const offendingConstraintIds = this.gcs.get_gcs_redundant_constraints();
      this.rebuildGcs();
      return { ok: false, reason: 'redundant', offendingConstraintIds };
    }

    this.domainConstraints.set(c.id, c);
    this.syncDomainFromGcs();
    return {
      ok: true,
      dof: this.readDof(),
      coords: this.coordDiffForAll(),
    };
  }

  async removeConstraint(id: string): Promise<{ dof: DofStatus }> {
    this.requireLoaded();
    const c = this.domainConstraints.get(id);
    if (!c) return { dof: this.readDof() };
    // planegcs GcsWrapper has no public remove method — rebuild from remaining primitives + constraints.
    this.domainConstraints.delete(id);
    this.rebuildGcs();
    return { dof: this.readDof() };
  }

  readCoords(primitiveId: string): { x1: number; y1: number; x2: number; y2: number } {
    const d = this.decomp.get(primitiveId);
    if (!d) throw new Error(`unknown primitive ${primitiveId}`);
    const sketchPrims = this.gcs.sketch_index?.get_primitives?.() ?? [];
    const points = new Map<string, { x: number; y: number }>();
    for (const sp of sketchPrims) if (sp.type === 'point') points.set(sp.id, { x: sp.x, y: sp.y });
    const s = points.get(d.pointIds['start'] ?? '');
    const e = points.get(d.pointIds['end'] ?? '');
    if (!s || !e) throw new Error('readCoords only supported for line-like primitives');
    return { x1: s.x, y1: s.y, x2: e.x, y2: e.y };
  }

  currentDof(): DofStatus {
    return this.readDof();
  }

  private requireLoaded(): void {
    if (!this.loaded) throw new Error('GcsSystem not loaded — call loadSketch first');
  }

  /**
   * Rebuild WASM state from scratch using current domainPrimitives + domainConstraints.
   * Called after removeConstraint since GcsWrapper has no public remove-by-id API.
   */
  private rebuildGcs(): void {
    // clear_data resets all internal WASM state (sketch_index, p_param_index, etc.)
    // without destroying the WASM module — safe to re-push after.
    this.gcs.clear_data();
    // Also clear our decomp map so pushPrimitiveDecomposition rebuilds it cleanly.
    this.decomp.clear();
    // Re-push geometry
    const gcsPrims: PlanegcsPrimitive[] = [];
    for (const p of this.domainPrimitives.values()) {
      this.pushPrimitiveDecomposition(p, gcsPrims);
    }
    this.gcs.push_primitives_and_params(gcsPrims as never);
    // Re-push remaining constraints
    for (const c of this.domainConstraints.values()) {
      if (isDimension(c)) {
        const resolvedValue = this.dimensionResolvedValue.get(c.id) ?? (c.value.kind === 'literal' ? c.value.value : 0);
        const gcsConstraints = this.translateDimensionConstraint(c, resolvedValue);
        if (gcsConstraints !== null) {
          for (const gc of gcsConstraints) this.gcs.push_primitive(gc as never);
        }
      } else {
        const gcsConstraints = this.translateConstraint(c);
        if (gcsConstraints !== null) {
          for (const gc of gcsConstraints) this.gcs.push_primitive(gc as never);
        }
      }
    }
    this.gcs.solve();
    this.gcs.apply_solution();
  }

  private translateConstraint(c: SketchConstraint): Array<Record<string, unknown>> | null {
    switch (c.kind) {
      case 'horizontal':    return [{ id: c.id, type: 'horizontal_l',   l_id: c.line }];
      case 'vertical':      return [{ id: c.id, type: 'vertical_l',     l_id: c.line }];
      case 'parallel':      return [{ id: c.id, type: 'parallel',       l1_id: c.line1, l2_id: c.line2 }];
      case 'perpendicular': return [{ id: c.id, type: 'perpendicular_ll', l1_id: c.line1, l2_id: c.line2 }];
      case 'tangent':       return [{ id: c.id, type: 'tangent_la',     l_id: c.line,  a_id: c.arc }];
      case 'equal':         return [{ id: c.id, type: 'equal_length',   l1_id: c.a,    l2_id: c.b }];
      case 'coincident': {
        const p1 = this.resolvePoint(c.a);
        const p2 = this.resolvePoint(c.b);
        if (!p1 || !p2) return null;
        return [{ id: c.id, type: 'p2p_coincident', p1_id: p1, p2_id: p2 }];
      }
      case 'symmetric': {
        const p1 = this.resolvePoint(c.a);
        const p2 = this.resolvePoint(c.b);
        if (!p1 || !p2) return null;
        return [{ id: c.id, type: 'p2p_symmetric_ppl', p1_id: p1, p2_id: p2, l_id: c.axis }];
      }
      case 'dim-length':
      case 'dim-distance':
      case 'dim-angle':
      case 'dim-radius':
      case 'dim-diameter':
      case 'dim-point-line-distance':
        // Dimensions flow through addDimension, not addConstraint.
        return null;
    }
  }

  private resolvePoint(ref: PointRef): string | null {
    const d = this.decomp.get(ref.primitiveId);
    if (!d) return null;
    return d.pointIds[ref.anchor] ?? null;
  }

  private coordDiffForAll(): PrimitiveCoordsDiff[] {
    const out: PrimitiveCoordsDiff[] = [];
    for (const [id] of this.domainPrimitives) {
      const fresh = this.readDomainPrimitive(id);
      const original = this.domainPrimitives.get(id);
      if (!fresh || !original) continue;
      const patch = this.diffPrimitive(original, fresh);
      if (patch) out.push({ primitiveId: id, patch });
    }
    return out;
  }

  private readDomainPrimitive(id: string): SketchPrimitive | null {
    const original = this.domainPrimitives.get(id);
    if (!original) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = (this.gcs.sketch_index?.get_primitives?.() ?? []) as PlanegcsPrimitive[];
    const pts = new Map<string, { x: number; y: number }>();
    // Also index circle/arc objects by id so we can read back their solved radius.
    const gcsPrimById = new Map<string, PlanegcsPrimitive>();
    for (const p of all) {
      if (p.type === 'point') pts.set(p.id, { x: p.x, y: p.y });
      gcsPrimById.set(p.id, p);
    }
    const d = this.decomp.get(id)!;
    switch (original.kind) {
      case 'line': {
        const s = pts.get(d.pointIds['start']!)!;
        const e = pts.get(d.pointIds['end']!)!;
        return { ...original, x1: s.x, y1: s.y, x2: e.x, y2: e.y };
      }
      case 'circle': {
        const c = pts.get(d.pointIds['center']!)!;
        const gcsCir = gcsPrimById.get(id);
        const r = (gcsCir?.type === 'circle') ? gcsCir.radius : original.r;
        return { ...original, cx: c.x, cy: c.y, r };
      }
      case 'arc': {
        const c = pts.get(d.pointIds['center']!)!;
        const gcsArc = gcsPrimById.get(id);
        const r = (gcsArc?.type === 'arc') ? gcsArc.radius : original.r;
        return { ...original, cx: c.x, cy: c.y, r };
      }
      case 'rectangle': {
        const bl = pts.get(d.pointIds['bl']!)!;
        const tr = pts.get(d.pointIds['tr']!)!;
        return { ...original, x: bl.x, y: bl.y, w: tr.x - bl.x, h: tr.y - bl.y };
      }
      case 'spline': {
        const controlPoints = original.controlPoints.map((_: unknown, i: number) => {
          const p = pts.get(d.pointIds[`cp${i}`]!)!;
          return { x: p.x, y: p.y };
        });
        return { ...original, controlPoints };
      }
    }
  }

  private diffPrimitive(a: SketchPrimitive, b: SketchPrimitive): Partial<SketchPrimitive> | null {
    const EPS = 1e-6;
    if (a.kind !== b.kind) return null;
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(a) as Array<keyof typeof a>) {
      if (k === 'id' || k === 'kind') continue;
      const av = (a as Record<string, unknown>)[k as string];
      const bv = (b as Record<string, unknown>)[k as string];
      if (typeof av === 'number' && typeof bv === 'number') {
        if (Math.abs(av - bv) > EPS) patch[k as string] = bv;
      } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
        patch[k as string] = bv;
      }
    }
    return Object.keys(patch).length > 0 ? (patch as Partial<SketchPrimitive>) : null;
  }

  async beginDrag(ref: PointRef): Promise<void> {
    this.requireLoaded();
    if (this.dragRef) throw new Error('drag already in progress; call endDrag first');
    const gcsPt = this.resolvePoint(ref);
    if (!gcsPt) throw new Error(`cannot resolve point for drag: ${JSON.stringify(ref)}`);
    this.dragRef = ref;
  }

  async dragTo(x: number, y: number): Promise<DragSolveResult> {
    this.requireLoaded();
    if (!this.dragRef) throw new Error('no active drag');
    const gcsPt = this.resolvePoint(this.dragRef)!;
    const startMs = performance.now();

    // Remove previous temp lock + anchor if any, via clear_data + rebuild.
    // rebuildGcs uses domainPrimitives as starting positions; we keep those
    // updated via syncDomainFromGcs after each solve so we don't snap back.
    if (this.dragLockId) {
      this.rebuildGcs();
    }

    // Create a new fixed-anchor point and a temporary coincident constraint.
    const anchorId = `__drag_anchor_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const lockId = `__drag_lock_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    this.dragAnchorId = anchorId;
    this.dragLockId = lockId;

    this.gcs.push_primitive({ id: anchorId, type: 'point', x, y, fixed: true } as never);
    this.gcs.push_primitive({
      id: lockId, type: 'p2p_coincident', p1_id: gcsPt, p2_id: anchorId, temporary: true
    } as never);

    this.gcs.solve();
    this.gcs.apply_solution();
    const solverMs = performance.now() - startMs;

    const coords = this.coordDiffForAll();
    // Sync domain so next rebuild (next dragTo or endDrag) starts from solved positions.
    this.syncDomainFromGcs();

    return { coords, dof: this.readDof(), solverMs };
  }

  async endDrag(): Promise<{ dof: DofStatus; finalCoords: PrimitiveCoordsDiff[] }> {
    this.requireLoaded();
    if (!this.dragRef) return { dof: this.readDof(), finalCoords: [] };
    // Compute final coords diff against original load-time positions before rebuilding.
    const finalCoords = this.coordDiffAgainstOriginals();
    if (this.dragLockId) {
      this.rebuildGcs();   // discard drag lock + anchor, solve from current domain positions
      this.dragLockId = null;
      this.dragAnchorId = null;
    }
    this.dragRef = null;
    return { dof: this.readDof(), finalCoords };
  }

  /**
   * Read current GCS-solved point positions back into domainPrimitives.
   * Called after each dragTo solve so that rebuildGcs() on the next dragTo
   * (or endDrag) starts from the dragged positions rather than the original ones.
   */
  private syncDomainFromGcs(): void {
    for (const [id, original] of this.domainPrimitives) {
      const fresh = this.readDomainPrimitive(id);
      if (fresh) this.domainPrimitives.set(id, { ...original, ...fresh });
    }
  }

  /**
   * Like coordDiffForAll but diffs current GCS state against originalPrimitives
   * (load-time snapshot), not domainPrimitives (which syncDomainFromGcs mutates).
   * Used by endDrag to report how far things moved from the initial load position.
   */
  private coordDiffAgainstOriginals(): PrimitiveCoordsDiff[] {
    const out: PrimitiveCoordsDiff[] = [];
    for (const [id, original] of this.originalPrimitives) {
      const fresh = this.readDomainPrimitive(id);
      if (!fresh) continue;
      const patch = this.diffPrimitive(original, fresh);
      if (patch) out.push({ primitiveId: id, patch });
    }
    return out;
  }

  async addPrimitive(p: SketchPrimitive): Promise<{ dof: DofStatus }> {
    this.requireLoaded();
    this.domainPrimitives.set(p.id, p);
    this.originalPrimitives.set(p.id, p);
    this.rebuildGcs();
    return { dof: this.readDof() };
  }

  async removePrimitive(id: string): Promise<{ dof: DofStatus }> {
    this.requireLoaded();
    this.domainPrimitives.delete(id);
    this.originalPrimitives.delete(id);
    // Also remove any constraint referencing this primitive.
    for (const [cid, c] of this.domainConstraints) {
      if (this.constraintReferences(c, id)) this.domainConstraints.delete(cid);
    }
    this.rebuildGcs();
    return { dof: this.readDof() };
  }

  async updatePrimitive(id: string, patch: Partial<SketchPrimitive>): Promise<{ dof: DofStatus }> {
    this.requireLoaded();
    const existing = this.domainPrimitives.get(id);
    if (!existing) return { dof: this.readDof() };
    const merged = { ...existing, ...patch } as SketchPrimitive;
    this.domainPrimitives.set(id, merged);
    this.originalPrimitives.set(id, merged);
    this.rebuildGcs();
    return { dof: this.readDof() };
  }

  private constraintReferences(c: SketchConstraint, primitiveId: string): boolean {
    switch (c.kind) {
      case 'horizontal':
      case 'vertical':      return c.line === primitiveId;
      case 'parallel':
      case 'perpendicular': return c.line1 === primitiveId || c.line2 === primitiveId;
      case 'tangent':       return c.line === primitiveId || c.arc === primitiveId;
      case 'equal':         return c.a === primitiveId || c.b === primitiveId;
      case 'coincident':    return c.a.primitiveId === primitiveId || c.b.primitiveId === primitiveId;
      case 'symmetric':                  return c.a.primitiveId === primitiveId || c.b.primitiveId === primitiveId || c.axis === primitiveId;
      case 'dim-length':                 return c.line === primitiveId;
      case 'dim-distance':               return c.a.primitiveId === primitiveId || c.b.primitiveId === primitiveId;
      case 'dim-angle':                  return c.line1 === primitiveId || c.line2 === primitiveId;
      case 'dim-radius':
      case 'dim-diameter':               return c.circle === primitiveId;
      case 'dim-point-line-distance':    return c.point.primitiveId === primitiveId || c.line === primitiveId;
    }
  }

  async addDimension(
    constraint: DimensionConstraint,
    resolvedValue: number
  ): Promise<AddDimensionResult> {
    this.requireLoaded();
    const gcs = this.translateDimensionConstraint(constraint, resolvedValue);
    if (gcs === null) {
      return { ok: false, reason: 'conflict', offendingConstraintIds: [constraint.id] };
    }
    for (const g of gcs) this.gcs.push_primitive(g as never);
    this.gcs.solve();
    this.gcs.apply_solution();

    if (this.gcs.has_gcs_conflicting_constraints()) {
      const offendingConstraintIds = this.gcs.get_gcs_conflicting_constraints();
      this.rebuildGcs();
      return { ok: false, reason: 'conflict', offendingConstraintIds };
    }
    if (this.gcs.has_gcs_redundant_constraints()) {
      const offendingConstraintIds = this.gcs.get_gcs_redundant_constraints();
      this.rebuildGcs();
      return { ok: false, reason: 'redundant', offendingConstraintIds };
    }

    this.domainConstraints.set(constraint.id, constraint);
    this.dimensionResolvedValue.set(constraint.id, resolvedValue);
    this.syncDomainFromGcs();
    return { ok: true, dof: this.readDof(), coords: this.coordDiffForAll() };
  }

  async removeDimension(id: string): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
    this.requireLoaded();
    const c = this.domainConstraints.get(id);
    if (!c) return { dof: this.readDof(), coords: [] };
    this.domainConstraints.delete(id);
    this.dimensionResolvedValue.delete(id);
    this.rebuildGcs();
    return { dof: this.readDof(), coords: this.coordDiffForAll() };
  }

  async updateDimensionValue(
    id: string,
    resolvedValue: number
  ): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
    this.requireLoaded();
    const c = this.domainConstraints.get(id);
    if (!c || !isDimension(c)) return { dof: this.readDof(), coords: [] };
    this.dimensionResolvedValue.set(id, resolvedValue);
    this.rebuildGcs();
    return { dof: this.readDof(), coords: this.coordDiffForAll() };
  }

  private translateDimensionConstraint(
    c: DimensionConstraint,
    value: number
  ): Array<Record<string, unknown>> | null {
    switch (c.kind) {
      case 'dim-length': {
        const d = this.decomp.get(c.line);
        if (!d?.pointIds['start'] || !d?.pointIds['end']) return null;
        return [{ id: c.id, type: 'p2p_distance', p1_id: d.pointIds['start'], p2_id: d.pointIds['end'], distance: value }];
      }
      case 'dim-distance': {
        const a = this.resolvePoint(c.a);
        const b = this.resolvePoint(c.b);
        if (!a || !b) return null;
        return [{ id: c.id, type: 'p2p_distance', p1_id: a, p2_id: b, distance: value }];
      }
      case 'dim-angle':
        return [{ id: c.id, type: 'l2l_angle_ll', l1_id: c.line1, l2_id: c.line2, angle: value * Math.PI / 180 }];
      case 'dim-radius':
        return [{ id: c.id, type: 'circle_radius', c_id: c.circle, radius: value }];
      case 'dim-diameter':
        return [{ id: c.id, type: 'circle_diameter', c_id: c.circle, diameter: value }];
      case 'dim-point-line-distance': {
        const p = this.resolvePoint(c.point);
        if (!p) return null;
        return [{ id: c.id, type: 'p2l_distance', p_id: p, l_id: c.line, distance: value }];
      }
    }
  }

  // Task 10 adds: redundant/conflict detection
}

function isDimension(c: SketchConstraint): c is DimensionConstraint {
  return c.kind.startsWith('dim-');
}

function resolveDimensionValue(
  c: DimensionConstraint,
  resolved: Record<string, number> | undefined
): number {
  if (c.value.kind === 'literal') return c.value.value;
  return resolved?.[c.id] ?? 0;
}
