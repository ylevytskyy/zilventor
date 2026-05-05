import type { SectionView, DrawingDocument } from '../index';

/**
 * Given a SectionView and its parent DrawingDocument, return the source kind
 * ('part' | 'assembly') and the source id (the partPath from DrawingSource).
 *
 * Validates that parentViewId resolves to a real view on some sheet.
 * Throws with a descriptive message if parentViewId is dangling.
 */
export function resolveSectionSource(
  view: SectionView,
  doc: DrawingDocument,
): { kind: 'part' | 'assembly'; id: string } {
  let parentFound = false;
  for (const sheet of doc.sheets) {
    if (sheet.views.some((v) => v.id === view.parentViewId)) {
      parentFound = true;
      break;
    }
  }
  if (!parentFound) {
    throw new Error(
      `resolveSectionSource: parentViewId "${view.parentViewId}" not found in any sheet of drawing "${doc.id}"`,
    );
  }
  return {
    kind: doc.source.sourceKind,
    id: doc.source.partPath,
  };
}
