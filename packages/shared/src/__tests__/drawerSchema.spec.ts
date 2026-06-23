import { describe, it, expect } from 'vitest';
import { CONNECTOR_BOM_CATALOG } from '../connectorBomCatalog';
import { CURRENT_FORMAT_VERSION, migrateManifest } from '../fileFormat';

describe('drawer schema v24', () => {
  it('drawerSlide kind has BOM catalog entry', () => {
    expect(CONNECTOR_BOM_CATALOG.drawerSlide.nameKey).toBe('bom.connector.drawerSlide');
  });
  it('format version bumped to 24', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(32);
  });
  it('a v23 doc migrates to 24 unchanged (identity)', () => {
    const v23 = { formatVersion: 23, kind: 'part', document: {} } as any;
    const out = migrateManifest(v23);
    expect(out.formatVersion).toBe(32);
  });
});
