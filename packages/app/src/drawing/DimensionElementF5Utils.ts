// packages/app/src/drawing/DimensionElementF5Utils.ts
// Shared cascade-text resolver for F5 dim kinds: baseline, ordinate, angular.
// Uses getState() snapshot — no useStore subscription. See note in DimensionElement.tsx.
import { useAppStore } from '../store/useAppStore';

type CascadeFields = {
  textOverride?: string;
  sourceParameterName?: string;
};

/**
 * Resolve display text for a F5 dim (baseline / ordinate / angular).
 *
 * Three-mode cascade (same as F4 LinearDimension):
 *   1. textOverride set → use verbatim.
 *   2. sourceParameterName set + param exists in activePart → use param.value formatted.
 *   3. Otherwise → use computedValue (distance in mm or angle in degrees).
 *
 * NOTE: Uses getState() snapshot, NOT useStore subscription.
 * DrawingCanvas re-renders on every store change, so this function is re-called
 * on each render. Adding a subscription here would be redundant and would add
 * render churn. Never add useStore() calls to components rendered inside DrawingCanvas
 * without first verifying that DrawingCanvas does NOT have React.memo applied.
 * This is a load-bearing structural dependency — see F4 cascade gotcha in
 * next_session_resume.md and DimensionElement.tsx lines 85-91 for the same pattern.
 */
export function resolveF5DimText(
  dim: CascadeFields,
  computedValue: number,
): string {
  if (typeof dim.textOverride === 'string') {
    return dim.textOverride;
  }
  if (typeof dim.sourceParameterName === 'string') {
    const activePart = useAppStore.getState().activePart;
    const param = activePart?.parameters[dim.sourceParameterName];
    if (param !== undefined) {
      return String(Math.round(param.value * 10) / 10);
    }
    // Orphan fallback (F4.5 pattern)
    return String(Math.round(computedValue * 10) / 10);
  }
  return String(Math.round(computedValue * 10) / 10);
}
