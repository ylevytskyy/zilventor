/**
 * R1 input-contract preflight (docs/abf-plugin/05-parity/03-processing-parity-requirements.md).
 *
 * Pure, manifest-level validity check: given the minimal facts a caller already
 * has in hand (resolved name, resolved material assignment, solid count, and an
 * optional geometry-validity flag), decides whether a panel may enter
 * boring/nesting/manufacturing-DXF, must be explicitly split first, or fails
 * with a named, i18n-keyed reason.
 *
 * Deliberately does NOT read PartDocument/OPFS/kernel state itself — callers
 * (resolvePanelSpec, aggregateBoresRecursive, …) already resolve these facts
 * from manifest data (and, for imports, from the persisted
 * ImportedFeature.solidColors length) without a kernel round-trip.
 */

export interface PanelPreflightInput {
  readonly name: string | null | undefined;
  readonly materialId: string | null | undefined;
  /** Number of solids the panel's geometry resolves to. Parametric parts
   *  (built through a PanelFeature) are single-solid by construction; for
   *  imported STEP bodies this is the persisted solidColors.length. */
  readonly solidCount: number;
  /** Closed-manifold / non-self-intersecting check. Optional because no
   *  general-purpose kernel validity check exists yet; omit/true = assumed
   *  valid, false = caller has evidence the solid is invalid. */
  readonly isManifold?: boolean;
}

export type PanelPreflightResult =
  | { readonly kind: 'pass' }
  | { readonly kind: 'split-required'; readonly reasonKey: string; readonly solidCount: number }
  | { readonly kind: 'fail'; readonly reasonKey: string };

/** A collected R1 preflight failure for one panel — reasonKey is an i18n key
 *  under `panel.preflight.*`, params are its interpolation values. Callers
 *  (aggregateBoresRecursive, aggregateCutListRecursive, resolvePanelSpec, …)
 *  collect these into an optional `diagnostics?` list (absent-not-empty:
 *  omitted when nothing failed, never written as []). */
export interface PanelPreflightDiagnostic {
  readonly partPath: string;
  readonly reasonKey: string;
  readonly params?: Record<string, unknown>;
}

export function panelPreflight(part: PanelPreflightInput): PanelPreflightResult {
  if (part.solidCount > 1) {
    return { kind: 'split-required', reasonKey: 'panel.preflight.splitRequired', solidCount: part.solidCount };
  }
  if (part.solidCount < 1 || part.isManifold === false) {
    return { kind: 'fail', reasonKey: 'panel.preflight.notManifold' };
  }
  if (!part.name || part.name.trim().length === 0) {
    return { kind: 'fail', reasonKey: 'panel.preflight.missingName' };
  }
  if (!part.materialId || part.materialId.trim().length === 0) {
    return { kind: 'fail', reasonKey: 'panel.preflight.missingMaterial' };
  }
  return { kind: 'pass' };
}
