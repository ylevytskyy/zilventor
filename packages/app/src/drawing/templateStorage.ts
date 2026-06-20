// ---------------------------------------------------------------------------
// Drawing-template OPFS storage (Milestone 3.3)
//
// Templates live under `templates/<slug>.zitpl` as UTF-8 JSON. They are a
// separate artifact from drawing documents (no manifest bump).
// ---------------------------------------------------------------------------

import type { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { importDrawingTemplate, type DrawingTemplate } from '@zilventor/shared';

const TEMPLATE_DIR = 'templates/';
const TEMPLATE_EXT = '.zitpl';

function slugify(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'template';
}

export function templatePath(name: string): string {
  return `${TEMPLATE_DIR}${slugify(name)}${TEMPLATE_EXT}`;
}

export async function saveTemplate(opfs: Opfs, template: DrawingTemplate): Promise<string> {
  const path = templatePath(template.name);
  await opfs.write(path, new TextEncoder().encode(JSON.stringify(template)));
  return path;
}

export async function listTemplates(opfs: Opfs): Promise<string[]> {
  const all = await opfs.listAll();
  return all.filter((p) => p.startsWith(TEMPLATE_DIR) && p.endsWith(TEMPLATE_EXT)).sort();
}

export async function loadTemplate(opfs: Opfs, path: string): Promise<DrawingTemplate> {
  const bytes = await opfs.read(path);
  return importDrawingTemplate(new TextDecoder().decode(bytes));
}
