/**
 * RepairCabinetGeometryCommand — cabinet-pose-fix Worker 2.
 *
 * Legacy cabinets (built before pose.translation/quaternion existed) load
 * with pose backfilled to {translation: position, quaternion: identity}
 * (fileFormat.ts:545-569 backfillAssembly4b) — WRONG for every panel whose
 * local box convention isn't already world-aligned at its stored corner
 * position. This command recomputes the correct pose per component from
 * (role, fileNameSuffix, position, dims) via @zilventor/shared's
 * computeExpectedPose/needsPoseRepair (suffix-keyed formula table transcribed
 * from the four cabinet templates) and overwrites ONLY the `pose` field —
 * `position`/`rotation` (the numbers CreateCabinetCommand originally wrote)
 * are never touched, so this is purely additive/corrective.
 *
 * fileNameSuffix recovery: CreateCabinetCommand names every panel .zipt
 * `${cabinetName} - ${fileNameSuffix}.zipt` (CreateCabinetCommand.ts:182) —
 * there is no separate stored field, so the suffix is recovered by stripping
 * the `${cab.name} - ` prefix and `.zipt` extension from partPath. A
 * component whose partPath doesn't match this shape (hardware, drawer-bank
 * children, foreign sub-assemblies) yields a null suffix and is left
 * completely untouched.
 *
 * Dims: read directly from the linked part's PanelFeature via
 * resolvePanelSpec (OPFS I/O owned by this command, mirroring
 * AddDrawerBankCommand's precedent of commands doing their own reads/writes).
 *
 * Door special case — 'Door' is intentionally excluded from
 * computeExpectedPose's table (ambiguous between templates from
 * (role, fileNameSuffix, position, dims) alone). Disambiguated here at the
 * DOCUMENT level, by which OTHER suffixes are present in the same cabinet:
 *
 *   - A 'Blind Filler' suffix present  → blindCornerCabinet.ts template.
 *     Its Door layout entry (blindCornerCabinet.ts:195-200) pushes
 *     `position` equal to `dp.pose.translation` (the door's real world
 *     center) — i.e. `position` IS the correct translation already, verified
 *     by reading the template. Only the quaternion is wrong post-backfill
 *     (identity instead of DOOR_POSE's Shepperd-derived value). Expected pose
 *     = { translation: component.position, quaternion: DOOR_POSE.quaternion }.
 *
 *   - A 'Return Side 1' suffix present (and no 'Blind Filler') →
 *     diagonalCornerCabinet.ts template. Its Door layout entry
 *     (diagonalCornerCabinet.ts:234-237) sets `rotation: uprightRot` (the
 *     REAL Euler triple, not {0,0,0}) and attaches no `pose` field at all —
 *     so backfillAssembly4b computes the door's quaternion from that REAL
 *     rotation, which is already correct. The door is skipped entirely.
 *
 *   - Neither marker present → skip (base/corner templates have no door).
 *
 * apply(): snapshot original bytes → unpackAssembly → recompute pose per
 * component (only where needsPoseRepair flags a mismatch) → if anything
 * changed, packAssembly + write + refresh subAssemblyDocs/solverDirty. If
 * nothing needed repair, OPFS is left untouched (byte-for-byte no-op —
 * guarantees idempotency by construction, not by re-serialization luck).
 *
 * revert(): restores the snapshotted original bytes verbatim.
 */
import type { Command } from './Command';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';
import { computeExpectedPose, needsPoseRepair, DOOR_POSE } from '@zilventor/shared';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { resolvePanelSpec, type PanelSpecCache } from '../shell/resolvePanelSpec';
import { useAppStore } from '../store/useAppStore';

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
};

export interface RepairCabinetGeometryOpts {
  cabinetPath: string;
  opfs: OpfsRWD;
  store?: typeof useAppStore;
}

/**
 * fileNameSuffix keys recognized by computeExpectedPose's SUFFIX_TABLE
 * (mirrored here — that table is private to repairCabinetPose.ts). Used only
 * as a cheap BrowserPane gating heuristic (hasRepairableLegacyPose); exact
 * detection always happens in apply() via computeExpectedPose/needsPoseRepair.
 */
const KNOWN_SUFFIXES = new Set([
  'Left Side', 'Right Side', 'Bottom', 'Top', 'Back', 'Toekick', 'Hanging Rail',
  'Leg 1 End', 'Leg 2 End', 'Back 1', 'Back 2', 'Bottom 1', 'Bottom 2', 'Top 1', 'Top 2',
  'Corner Post', 'Blind Filler', 'Return Side 1', 'Return Side 2', 'Toekick 1', 'Toekick 2',
]);
const SHELF_SUFFIX_RE = /^Shelf \d+$/;

/** partPath = `${cabinetName} - ${fileNameSuffix}.zipt` (CreateCabinetCommand.ts:182). */
function deriveFileNameSuffix(cabinetName: string, partPath: string): string | null {
  const prefix = `${cabinetName} - `;
  if (!partPath.startsWith(prefix) || !partPath.endsWith('.zipt')) return null;
  return partPath.slice(prefix.length, -'.zipt'.length);
}

/**
 * True when `c.pose` carries the exact legacy-backfill signature
 * (fileFormat.ts:545-569): translation identical to `position` AND an
 * identity quaternion. Absent pose also counts (needsPoseRepair semantics).
 *
 * Checking translation too (not quaternion alone) matters: several roles
 * (bottom/top/shelf — family C) legitimately have an identity quaternion when
 * CORRECTLY posed, because their world rotation really is identity. What
 * distinguishes a legacy component is that its translation is UNCORRECTED —
 * still the raw corner `position`, not `position` shifted by the role's
 * half-extent/thickness offset. A real family-C translation always differs
 * from `position` in at least one axis (nonzero half-extent), so this
 * combined check has no false positives on a freshly-built cabinet.
 */
function looksLikeLegacyBackfill(c: ComponentInstance, eps = 1e-6): boolean {
  const pose = c.pose;
  if (!pose) return true;
  const t = pose.translation;
  const p = c.position;
  const translationUncorrected =
    Math.abs(t.x - p.x) < eps && Math.abs(t.y - p.y) < eps && Math.abs(t.z - p.z) < eps;
  if (!translationUncorrected) return false;
  const q = pose.quaternion;
  return Math.abs(q[0]) < 1e-3 && Math.abs(q[1]) < 1e-3 && Math.abs(q[2]) < 1e-3 && Math.abs(q[3] - 1) < 1e-3;
}

/**
 * Cheap gating heuristic for BrowserPane (no OPFS/dims reads): true when
 * `cab` has at least one component whose fileNameSuffix is recognized and
 * whose pose still carries the legacy-backfill signature. Exact detection
 * (which may clear some of these as already-correct, e.g. a diagonal-corner
 * Door) happens in apply() — this only decides whether to SHOW the repair
 * option, never whether to actually repair.
 */
export function hasRepairableLegacyPose(cab: AssemblyDocument): boolean {
  const hasBlindFiller = cab.components.some(
    (c) => deriveFileNameSuffix(cab.name, c.partPath) === 'Blind Filler',
  );
  for (const c of cab.components) {
    const suffix = deriveFileNameSuffix(cab.name, c.partPath);
    if (suffix === null) continue;
    if (suffix === 'Door') {
      if (hasBlindFiller && looksLikeLegacyBackfill(c)) return true;
      continue;
    }
    if (!KNOWN_SUFFIXES.has(suffix) && !SHELF_SUFFIX_RE.test(suffix)) continue;
    if (looksLikeLegacyBackfill(c)) return true;
  }
  return false;
}

export class RepairCabinetGeometryCommand implements Command {
  readonly name = 'RepairCabinetGeometry';
  private readonly store: typeof useAppStore;
  private originalBytes: Uint8Array | null = null;

  constructor(private readonly opts: RepairCabinetGeometryOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const { cabinetPath, opfs } = this.opts;
    const originalBytes = await opfs.read(cabinetPath);
    this.originalBytes = originalBytes;

    const cab = await unpackAssembly(originalBytes);
    const hasBlindFiller = cab.components.some(
      (c) => deriveFileNameSuffix(cab.name, c.partPath) === 'Blind Filler',
    );

    const specCache: PanelSpecCache = new Map();
    let changed = false;
    const nextComponents: ComponentInstance[] = [];

    for (const c of cab.components) {
      const suffix = deriveFileNameSuffix(cab.name, c.partPath);
      if (suffix === null) {
        nextComponents.push(c);
        continue;
      }

      if (suffix === 'Door') {
        // See the Door decision-tree doc comment above the class.
        if (hasBlindFiller) {
          const expected = { translation: { ...c.position }, quaternion: DOOR_POSE.quaternion };
          if (needsPoseRepair(c, expected)) {
            nextComponents.push({ ...c, pose: expected });
            changed = true;
            continue;
          }
        }
        nextComponents.push(c);
        continue;
      }

      const spec = await resolvePanelSpec(opfs, c.partPath, specCache);
      if (!spec) {
        nextComponents.push(c);
        continue;
      }

      const expected = computeExpectedPose({
        role: c.role ?? '',
        fileNameSuffix: suffix,
        position: c.position,
        dims: { length: spec.length, width: spec.width, thickness: spec.thickness },
      });

      if (expected && needsPoseRepair(c, expected)) {
        nextComponents.push({ ...c, pose: expected });
        changed = true;
      } else {
        nextComponents.push(c);
      }
    }

    if (!changed) return;

    const repairedCab: AssemblyDocument = { ...cab, components: nextComponents };
    await opfs.write(cabinetPath, await packAssembly(repairedCab, new Uint8Array()));
    await this.reload(repairedCab);
  }

  async revert(): Promise<void> {
    if (!this.originalBytes) return;
    const { cabinetPath, opfs } = this.opts;
    await opfs.write(cabinetPath, this.originalBytes);
    const cab = await unpackAssembly(this.originalBytes);
    await this.reload(cab);
  }

  private async reload(cab: AssemblyDocument): Promise<void> {
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[this.opts.cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty(true);
  }
}
