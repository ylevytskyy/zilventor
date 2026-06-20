// ---------------------------------------------------------------------------
// Drawing templates (Milestone 3.3)
//
// A template is the *chrome* of a drawing sheet — size, orientation, title block
// and (optional) underlay — with all content (views/dimensions/annotations/
// dimension-groups) stripped. It is a separate OPFS artifact, NOT document data,
// so there is no document manifest bump.
// ---------------------------------------------------------------------------

import type { DrawingSheet, SheetSize, TitleBlockOverrides, DxfUnderlay } from './types';

export const DRAWING_TEMPLATE_FORMAT_VERSION = 1;

export type DrawingTemplate = {
  readonly formatVersion: number;
  readonly name: string;
  readonly size: SheetSize;
  readonly orientation: 'landscape' | 'portrait';
  readonly titleBlock: TitleBlockOverrides;
  readonly underlay?: DxfUnderlay;
};

/** Strip a sheet down to a reusable template (keeps title block + underlay). */
export function exportDrawingTemplate(sheet: DrawingSheet, name?: string): DrawingTemplate {
  return {
    formatVersion: DRAWING_TEMPLATE_FORMAT_VERSION,
    name: name ?? sheet.name,
    size: sheet.size,
    orientation: sheet.orientation,
    titleBlock: sheet.titleBlock,
    ...(sheet.underlay !== undefined ? { underlay: sheet.underlay } : {}),
  };
}

/** Build a fresh (empty-content) sheet from a template. */
export function applyTemplateToNewSheet(
  template: DrawingTemplate,
  opts: { id: string; name: string },
): DrawingSheet {
  return {
    id: opts.id,
    name: opts.name,
    size: template.size,
    orientation: template.orientation,
    views: [],
    dimensions: [],
    annotations: [],
    titleBlock: template.titleBlock,
    dimensionGroups: [],
    ...(template.underlay !== undefined ? { underlay: template.underlay } : {}),
  };
}

/** Parse + validate a serialized template; throws on a bad shape. */
export function importDrawingTemplate(json: string): DrawingTemplate {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('invalid drawing template: not an object');
  }
  const t = parsed as Record<string, unknown>;
  if (typeof t.formatVersion !== 'number') throw new Error('invalid drawing template: formatVersion');
  if (typeof t.name !== 'string') throw new Error('invalid drawing template: name');
  if (t.orientation !== 'landscape' && t.orientation !== 'portrait') {
    throw new Error('invalid drawing template: orientation');
  }
  if (typeof t.size !== 'object' || t.size === null) throw new Error('invalid drawing template: size');
  if (typeof t.titleBlock !== 'object' || t.titleBlock === null) {
    throw new Error('invalid drawing template: titleBlock');
  }
  return {
    formatVersion: t.formatVersion,
    name: t.name,
    size: t.size as SheetSize,
    orientation: t.orientation,
    titleBlock: t.titleBlock as TitleBlockOverrides,
    ...(t.underlay !== undefined ? { underlay: t.underlay as DxfUnderlay } : {}),
  };
}
