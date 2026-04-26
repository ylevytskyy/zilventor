import type { Vec3, AssemblyConstraint } from '@zilventor/shared';
import type { Quat } from './quat';
import type { PartLocalGeometry } from './AssemblyConstraintRefs';
import {
  buildMateFaceFaceResiduals, buildMateFaceFaceJacobian,
  buildMateAxisAxisResiduals, buildMateAxisAxisJacobian,
  buildMatePointPointResiduals, buildMatePointPointJacobian,
  buildMatePointFaceResiduals, buildMatePointFaceJacobian,
  buildMatePointAxisResiduals, buildMatePointAxisJacobian,
  buildFlushFaceFaceResiduals, buildFlushFaceFaceJacobian,
  buildAngleResiduals, buildAngleJacobian,
  buildInsertResiduals, buildInsertJacobian,
} from './Residuals';
import { choleskySolve, jacobiSVD } from './linalg';
import { quatNormalize } from './quat';

export type ComponentPose = { id: string; T: Vec3; q: Quat };
export type SolverInput = {
  components: ComponentPose[];
  grounded: Set<string>;
  constraints: AssemblyConstraint[];
  resolvedRefs: Map<string, PartLocalGeometry>;  // keyed by `${constraint.id}#${componentId}`
  paramValues: Record<string, number>;
};

export const SOFT_NORM_WEIGHT = 10;

export function unknownsLayout(input: SolverInput): { idToOffset: Map<string, number>; total: number } {
  const map = new Map<string, number>();
  let off = 0;
  for (const c of input.components) {
    if (input.grounded.has(c.id)) continue;
    map.set(c.id, off);
    off += 7;
  }
  return { idToOffset: map, total: off };
}

function poseAt(
  input: SolverInput, x: number[], idToOffset: Map<string, number>, id: string,
): { T: Vec3; q: Quat } {
  const off = idToOffset.get(id);
  if (off === undefined) {
    const c = input.components.find((c) => c.id === id);
    if (!c) throw new Error(`unknown component ${id}`);
    return { T: c.T, q: c.q };
  }
  return {
    T: { x: x[off]!, y: x[off + 1]!, z: x[off + 2]! },
    q: [x[off + 3]!, x[off + 4]!, x[off + 5]!, x[off + 6]!],
  };
}

function resolveOffset(p: any, paramValues: Record<string, number>): number {
  if (p.kind === 'literal') return p.value;
  return paramValues[p.paramName] ?? 0;
}

function refComponentId(k: AssemblyConstraint, side: 'A' | 'B'): string {
  return side === 'A' ? k.refA.componentId : k.refB.componentId;
}

function buildSingleResidual(
  k: AssemblyConstraint,
  refA: PartLocalGeometry, refB: PartLocalGeometry,
  pA: { T: Vec3; q: Quat }, pB: { T: Vec3; q: Quat },
  paramValues: Record<string, number>,
): number[] {
  if (k.kind === 'mate') {
    if (refA.kind === 'plane' && refB.kind === 'plane')
      return buildMateFaceFaceResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
    if (refA.kind === 'axis' && refB.kind === 'axis')
      return buildMateAxisAxisResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
    if (refA.kind === 'point' && refB.kind === 'point')
      return buildMatePointPointResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q);
    if (refA.kind === 'point' && refB.kind === 'plane')
      return buildMatePointFaceResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q);
    if (refA.kind === 'plane' && refB.kind === 'point')
      return buildMatePointFaceResiduals(refB, refA, pB.T, pB.q, pA.T, pA.q);
    if (refA.kind === 'point' && refB.kind === 'axis')
      return buildMatePointAxisResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q);
    if (refA.kind === 'axis' && refB.kind === 'point')
      return buildMatePointAxisResiduals(refB, refA, pB.T, pB.q, pA.T, pA.q);
    throw new Error(`mate: unsupported ref pairing ${refA.kind}/${refB.kind}`);
  }
  if (k.kind === 'flush') return buildFlushFaceFaceResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
  if (k.kind === 'angle') return buildAngleResiduals(refA, refB, pA.q, pB.q, resolveOffset(k.angle, paramValues));
  return buildInsertResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
}

function buildSingleJacobianBlock(
  k: AssemblyConstraint,
  refA: PartLocalGeometry, refB: PartLocalGeometry,
  pA: { T: Vec3; q: Quat }, pB: { T: Vec3; q: Quat },
  paramValues: Record<string, number>,
): number[][] {
  if (k.kind === 'mate') {
    if (refA.kind === 'plane' && refB.kind === 'plane')
      return buildMateFaceFaceJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
    if (refA.kind === 'axis' && refB.kind === 'axis')
      return buildMateAxisAxisJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
    if (refA.kind === 'point' && refB.kind === 'point')
      return buildMatePointPointJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q);
    if (refA.kind === 'point' && refB.kind === 'plane')
      return buildMatePointFaceJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q);
    if (refA.kind === 'plane' && refB.kind === 'point') {
      // Swap A/B on the inner call, then swap the column blocks back
      const J = buildMatePointFaceJacobian(refB, refA, pB.T, pB.q, pA.T, pA.q);
      return swapAB(J);
    }
    if (refA.kind === 'point' && refB.kind === 'axis')
      return buildMatePointAxisJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q);
    if (refA.kind === 'axis' && refB.kind === 'point') {
      const J = buildMatePointAxisJacobian(refB, refA, pB.T, pB.q, pA.T, pA.q);
      return swapAB(J);
    }
    throw new Error(`mate: unsupported ref pairing ${refA.kind}/${refB.kind}`);
  }
  if (k.kind === 'flush') return buildFlushFaceFaceJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
  if (k.kind === 'angle') return buildAngleJacobian(refA, refB, pA.q, pB.q, resolveOffset(k.angle, paramValues));
  return buildInsertJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q, resolveOffset(k.offset, paramValues));
}

/** When we swap A/B in the residual call (e.g., plane-point becomes point-face with A/B swapped),
 *  the Jacobian's column blocks must also swap: cols 0-6 ↔ cols 7-13. */
function swapAB(J: number[][]): number[][] {
  return J.map((row) => {
    const out = new Array(14).fill(0);
    for (let c = 0; c < 7; c++) { out[c] = row[c + 7]!; out[c + 7] = row[c]!; }
    return out;
  });
}

export function buildAllResiduals(input: SolverInput, x: number[]): number[] {
  const { idToOffset } = unknownsLayout(input);
  const out: number[] = [];
  for (const k of input.constraints) {
    if (k.suppressed) continue;
    const idA = refComponentId(k, 'A');
    const idB = refComponentId(k, 'B');
    const refA = input.resolvedRefs.get(`${k.id}#${idA}`);
    const refB = input.resolvedRefs.get(`${k.id}#${idB}`);
    if (!refA || !refB) continue;  // broken-ref handling
    const pA = poseAt(input, x, idToOffset, idA);
    const pB = poseAt(input, x, idToOffset, idB);
    out.push(...buildSingleResidual(k, refA, refB, pA, pB, input.paramValues));
  }
  // Soft-norm rows: SOFT_NORM_WEIGHT * (||q||^2 - 1) per non-grounded component
  for (const c of input.components) {
    if (input.grounded.has(c.id)) continue;
    const off = idToOffset.get(c.id)!;
    const q = [x[off + 3]!, x[off + 4]!, x[off + 5]!, x[off + 6]!];
    const norm2 = q[0]! ** 2 + q[1]! ** 2 + q[2]! ** 2 + q[3]! ** 2;
    out.push(SOFT_NORM_WEIGHT * (norm2 - 1));
  }
  return out;
}

export function buildAllJacobian(input: SolverInput, x: number[]): number[][] {
  const { idToOffset, total } = unknownsLayout(input);
  const J: number[][] = [];
  // Process each constraint
  for (const k of input.constraints) {
    if (k.suppressed) continue;
    const idA = refComponentId(k, 'A');
    const idB = refComponentId(k, 'B');
    const refA = input.resolvedRefs.get(`${k.id}#${idA}`);
    const refB = input.resolvedRefs.get(`${k.id}#${idB}`);
    if (!refA || !refB) continue;
    const pA = poseAt(input, x, idToOffset, idA);
    const pB = poseAt(input, x, idToOffset, idB);
    const block = buildSingleJacobianBlock(k, refA, refB, pA, pB, input.paramValues);
    const offA = idToOffset.get(idA);  // undefined if grounded
    const offB = idToOffset.get(idB);
    for (const blockRow of block) {
      const row = new Array(total).fill(0);
      // Place A's 7 columns (0-6 of block) at offA
      if (offA !== undefined) {
        for (let c = 0; c < 7; c++) row[offA + c] = blockRow[c]!;
      }
      // Place B's 7 columns (7-13 of block) at offB
      if (offB !== undefined) {
        for (let c = 0; c < 7; c++) row[offB + c] = blockRow[7 + c]!;
      }
      J.push(row);
    }
  }
  // Soft-norm rows
  for (const c of input.components) {
    if (input.grounded.has(c.id)) continue;
    const off = idToOffset.get(c.id)!;
    const q = [x[off + 3]!, x[off + 4]!, x[off + 5]!, x[off + 6]!];
    const row = new Array(total).fill(0);
    // d(SOFT_NORM_WEIGHT * (||q||^2 - 1)) / dq_i = 2 * SOFT_NORM_WEIGHT * q_i
    row[off + 3] = 2 * SOFT_NORM_WEIGHT * q[0]!;
    row[off + 4] = 2 * SOFT_NORM_WEIGHT * q[1]!;
    row[off + 5] = 2 * SOFT_NORM_WEIGHT * q[2]!;
    row[off + 6] = 2 * SOFT_NORM_WEIGHT * q[3]!;
    J.push(row);
  }
  return J;
}

// ─── LM solver ───────────────────────────────────────────────────────────────

export type SolverDefaults = {
  lambda0: number; lambdaMax: number;
  epsAbs: number; epsStep: number; epsResid: number;
  maxIters: number;
};
const DEFAULTS: SolverDefaults = {
  lambda0: 1e-3, lambdaMax: 1e8,
  epsAbs: 1e-6, epsStep: 1e-9, epsResid: 1e-3,
  maxIters: 50,
};

export type LMResult = {
  x: number[];
  finalResiduals: number[];
  J: number[][];
  converged: boolean;
  iterations: number;
};

function norm(v: number[]): number {
  let s = 0; for (const xi of v) s += xi * xi; return Math.sqrt(s);
}

function matMulATA(J: number[][]): number[][] {
  const m = J.length;
  const n = J.length === 0 ? 0 : J[0]!.length;
  const out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k]![i]! * J[k]![j]!;
      out[i]![j] = s;
      out[j]![i] = s;
    }
  return out;
}

function matVecAT(J: number[][], r: number[]): number[] {
  const m = J.length;
  const n = J.length === 0 ? 0 : J[0]!.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < m; k++) out[i] += J[k]![i]! * r[k]!;
  return out;
}

export function lmSolve(
  input: SolverInput, x0: number[], defaults: Partial<SolverDefaults> = {},
): LMResult {
  const D = { ...DEFAULTS, ...defaults };
  let x = x0.slice();
  let lambda = D.lambda0;
  let r = buildAllResiduals(input, x);
  let J = buildAllJacobian(input, x);

  // Trivial case: no unknowns (all components grounded or no components)
  if (x.length === 0) {
    return { x, finalResiduals: r, J, converged: true, iterations: 0 };
  }

  let it = 0;
  for (; it < D.maxIters; it++) {
    const H = matMulATA(J);
    for (let i = 0; i < H.length; i++) H[i]![i] = H[i]![i]! + lambda * Math.max(H[i]![i]!, 1e-12);
    const g = matVecAT(J, r);
    const negG = g.map((v) => -v);
    let dx: number[];
    try {
      dx = choleskySolve(H, negG);
    } catch {
      lambda *= 2;
      if (lambda > D.lambdaMax) break;
      continue;
    }
    const xNew = x.map((v, i) => v + dx[i]!);
    // Renormalize quaternions in xNew
    const { idToOffset } = unknownsLayout(input);
    for (const off of idToOffset.values()) {
      const q = quatNormalize([xNew[off + 3]!, xNew[off + 4]!, xNew[off + 5]!, xNew[off + 6]!]);
      xNew[off + 3] = q[0]; xNew[off + 4] = q[1]; xNew[off + 5] = q[2]; xNew[off + 6] = q[3];
    }
    const rNew = buildAllResiduals(input, xNew);
    if (norm(rNew) < norm(r)) {
      x = xNew; r = rNew; J = buildAllJacobian(input, x);
      lambda /= 2;
      if (norm(r) < D.epsAbs || norm(dx) < D.epsStep) { it++; break; }
    } else {
      lambda *= 2;
      if (lambda > D.lambdaMax) break;
    }
  }
  // Determine convergence: max constraint residual (excluding soft-norm rows) under epsResid
  const constraintRowCount = r.length - input.components.filter((c) => !input.grounded.has(c.id)).length;
  let maxAbs = 0;
  for (let i = 0; i < constraintRowCount; i++) maxAbs = Math.max(maxAbs, Math.abs(r[i]!));
  return { x, finalResiduals: r, J, converged: maxAbs < D.epsResid, iterations: it };
}

// ─── solveAssembly higher-level API ──────────────────────────────────────────

export type AssemblySolveInput = Omit<SolverInput, 'grounded'> & { groundedComponentIds: string[] };

export type AssemblyDiagnostics = {
  dofCount: number;
  status: 'fully-constrained' | 'underconstrained' | 'over-constrained' | 'did-not-converge';
  perConstraint: Map<string, { residual: number; conflict: boolean; brokenRef: boolean }>;
  message?: string;
};

export type AssemblySolveResult = {
  poses: Map<string, { translation: Vec3; quaternion: Quat }>;
  finalResiduals: number[];
  J: number[][];
  freeDofBasis: Float64Array;  // (n_unknowns × n_free) flat, column-major
  diagnostics: AssemblyDiagnostics;
};

function constraintResidualCount(k: AssemblyConstraint, refA: PartLocalGeometry, refB: PartLocalGeometry): number {
  if (k.kind === 'flush')  return 3;
  if (k.kind === 'angle')  return 1;
  if (k.kind === 'insert') return 7;
  // mate: depends on pairing
  const a = refA.kind, b = refB.kind;
  if (a === 'plane' && b === 'plane') return 3;
  if (a === 'axis'  && b === 'axis')  return 4;
  if (a === 'point' && b === 'point') return 3;
  if ((a === 'point' && b === 'plane') || (a === 'plane' && b === 'point')) return 1;
  if ((a === 'point' && b === 'axis')  || (a === 'axis'  && b === 'point')) return 2;
  return 0;
}

export function solveAssembly(input: AssemblySolveInput): AssemblySolveResult {
  // Auto-anchor fallback if no grounded component
  let grounded = new Set(input.groundedComponentIds);
  let autoAnchorMessage: string | undefined;
  if (grounded.size === 0 && input.components.length > 0) {
    grounded = new Set([input.components[0]!.id]);
    autoAnchorMessage = `no grounded component — auto-anchored ${input.components[0]!.id} for this solve`;
  }

  const solverInput: SolverInput = {
    components: input.components,
    grounded,
    constraints: input.constraints,
    resolvedRefs: input.resolvedRefs,
    paramValues: input.paramValues,
  };

  // Build initial x from component poses
  const { idToOffset, total } = unknownsLayout(solverInput);
  const x0 = new Array(total).fill(0);
  for (const c of input.components) {
    const off = idToOffset.get(c.id);
    if (off === undefined) continue;
    x0[off]     = c.T.x; x0[off + 1] = c.T.y; x0[off + 2] = c.T.z;
    x0[off + 3] = c.q[0]; x0[off + 4] = c.q[1]; x0[off + 5] = c.q[2]; x0[off + 6] = c.q[3];
  }

  const lm = lmSolve(solverInput, x0);

  // Decompose poses
  const poses = new Map<string, { translation: Vec3; quaternion: Quat }>();
  for (const c of input.components) {
    const off = idToOffset.get(c.id);
    if (off === undefined) {
      poses.set(c.id, { translation: c.T, quaternion: c.q });
    } else {
      poses.set(c.id, {
        translation: { x: lm.x[off]!, y: lm.x[off + 1]!, z: lm.x[off + 2]! },
        quaternion: [lm.x[off + 3]!, lm.x[off + 4]!, lm.x[off + 5]!, lm.x[off + 6]!] as Quat,
      });
    }
  }

  // SVD for free-DOF detection
  const J = lm.J;
  let freeDofBasis = new Float64Array(0);
  let dofCount = 0;
  if (J.length > 0 && J[0]!.length > 0 && J.length >= J[0]!.length) {
    const Jcopy = J.map((row) => row.slice());
    const { s, V } = jacobiSVD(Jcopy);
    const sMax = Math.max(...s);
    const epsRank = 1e-6 * (sMax || 1);
    const freeCols: number[] = [];
    for (let j = 0; j < s.length; j++) if (s[j]! < epsRank) freeCols.push(j);
    dofCount = freeCols.length;
    freeDofBasis = new Float64Array(V.length * freeCols.length);
    for (let c = 0; c < freeCols.length; c++)
      for (let r = 0; r < V.length; r++)
        freeDofBasis[c * V.length + r] = V[r]![freeCols[c]!]!;
  }

  // Per-constraint residual breakdown
  const perConstraint = new Map<string, { residual: number; conflict: boolean; brokenRef: boolean }>();
  let row = 0;
  for (const k of input.constraints) {
    if (k.suppressed) {
      perConstraint.set(k.id, { residual: 0, conflict: false, brokenRef: false });
      continue;
    }
    const refA = input.resolvedRefs.get(`${k.id}#${refComponentId(k, 'A')}`);
    const refB = input.resolvedRefs.get(`${k.id}#${refComponentId(k, 'B')}`);
    if (!refA || !refB) {
      perConstraint.set(k.id, { residual: 0, conflict: false, brokenRef: true });
      continue;
    }
    const count = constraintResidualCount(k, refA, refB);
    let maxAbs = 0;
    for (let i = 0; i < count; i++) maxAbs = Math.max(maxAbs, Math.abs(lm.finalResiduals[row + i] ?? 0));
    perConstraint.set(k.id, { residual: maxAbs, conflict: maxAbs > 1e-3, brokenRef: false });
    row += count;
  }

  // Top-level status
  let status: AssemblyDiagnostics['status'];
  if (!lm.converged) status = 'did-not-converge';
  else if (Array.from(perConstraint.values()).some((v) => v.conflict)) status = 'over-constrained';
  else if (dofCount > 0) status = 'underconstrained';
  else status = 'fully-constrained';

  return {
    poses,
    finalResiduals: lm.finalResiduals,
    J: lm.J,
    freeDofBasis,
    diagnostics: { dofCount, status, perConstraint, ...(autoAnchorMessage !== undefined ? { message: autoAnchorMessage } : {}) },
  };
}
