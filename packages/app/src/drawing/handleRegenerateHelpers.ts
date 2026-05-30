// packages/app/src/drawing/handleRegenerateHelpers.ts
/**
 * Extracted dispatch logic for handleRegenerate in DrawingCanvas.tsx.
 * Exported for unit-testability.
 *
 * The base/projected/iso path is replicated here from DrawingCanvas so that
 * ALL four view kinds are handled in one testable unit. DrawingCanvas.handleRegenerate
 * becomes a thin wrapper that calls buildHandleRegenerate.
 */
import type {
  DrawingView,
  ViewOrientation,
  ProjectedGeometry,
  SectionView,
  DetailView,
  BaseView,
  ProjectedView,
  IsoView,
} from '@zilventor/shared';
import { autoPlaceCenterMarks } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';
import { regenerateSectionView } from './regenerateSectionView';
import { regenerateDetailView } from './regenerateDetailView';
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import { deriveProjectedOrientation } from '@zilventor/shared/src/drawing/deriveProjectedOrientation';
import { useAppStore } from '../store/useAppStore';

export type HandleRegenerateOptions = {
  views: readonly DrawingView[];
  sheetId: string;
  bus: CommandBus;
  staleViews: Set<string>;
  clearStaleView: (viewId: string) => void;
  projectViewFromSourceFn: (
    orientation: ViewOrientation,
  ) => Promise<{ projection: ProjectedGeometry; inputFingerprint: string }>;
};

/**
 * Builds the async handleRegenerate dispatcher, extracted for testability.
 * Called from DrawingCanvas.handleRegenerate with the real dependencies.
 *
 * Section/detail views delegate to the dedicated helpers from B1/B2.
 * Base/projected/iso views follow the existing inline logic (unchanged behaviour).
 *
 * Stale marker is cleared ONLY on success. On failure the marker is left intact
 * so the user can retry; the error is logged to the console.
 */
export function buildHandleRegenerate(
  opts: HandleRegenerateOptions,
): (viewId: string) => Promise<void> {
  const { views, sheetId, bus, staleViews, clearStaleView, projectViewFromSourceFn } = opts;

  /**
   * Regenerate a single base/projected/iso view by calling projectViewFromSource
   * and committing via RegenerateViewCommand.
   * This is the EXISTING logic from DrawingCanvas, replicated here unchanged.
   */
  async function regenerateBaseIsoProjected(
    view: BaseView | ProjectedView | IsoView,
  ): Promise<void> {
    let orientation: ViewOrientation;
    if (view.kind === 'base') {
      orientation = view.orientation;
    } else if (view.kind === 'iso') {
      orientation = `iso-${view.corner}` as ViewOrientation;
    } else {
      // 'projected'
      const baseView = views.find(
        (v): v is BaseView => v.id === (view as ProjectedView).baseViewId && v.kind === 'base',
      );
      if (!baseView) throw new Error(`REGEN: base view not found for projected view "${view.id}"`);
      orientation = deriveProjectedOrientation(baseView.orientation, (view as ProjectedView).direction);
    }
    const { projection, inputFingerprint } = await projectViewFromSourceFn(orientation);
    const centerMarkAnnotations = autoPlaceCenterMarks(projection, view.id);
    await bus.execute(
      new RegenerateViewCommand({ sheetId, viewId: view.id, projection, inputFingerprint, centerMarkAnnotations }),
    );
  }

  return async (viewId: string): Promise<void> => {
    const view = views.find((v) => v.id === viewId);
    if (!view) return;

    try {
      if (view.kind === 'section') {
        await regenerateSectionView(view as SectionView, sheetId, bus);
      } else if (view.kind === 'detail') {
        await regenerateDetailView(
          view as DetailView,
          sheetId,
          bus,
          (parentId: string) => staleViews.has(parentId),
          async (parentView: DrawingView) => {
            if (parentView.kind === 'section') {
              await regenerateSectionView(parentView as SectionView, sheetId, bus);
            } else if (
              parentView.kind === 'base' ||
              parentView.kind === 'projected' ||
              parentView.kind === 'iso'
            ) {
              await regenerateBaseIsoProjected(
                parentView as BaseView | ProjectedView | IsoView,
              );
            }
          },
        );
      } else if (
        view.kind === 'base' ||
        view.kind === 'projected' ||
        view.kind === 'iso'
      ) {
        await regenerateBaseIsoProjected(view as BaseView | ProjectedView | IsoView);
      } else {
        // Unknown view kind — skip silently.
        return;
      }
      clearStaleView(viewId);
    } catch (err) {
      console.error('[handleRegenerate] failed:', err);
      // Surface the thrown message in the status bar so the user sees a clear reason
      // (e.g. "Assembly section Regenerate is not yet supported — re-create the section view.").
      // Do NOT clear stale marker on error — leave it for the user to retry.
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().setStatus(msg);
    }
  };
}
