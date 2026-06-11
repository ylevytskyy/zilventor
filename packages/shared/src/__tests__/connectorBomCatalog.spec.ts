import { describe, it, expect } from 'vitest';
import { CONNECTOR_BOM_CATALOG, type ConnectorBomEntry } from '../connectorBomCatalog';
import type { BoreConnectorKind } from '../bore';

const ALL_KINDS = [
  'confirmat', 'minifix', 'dowel', 'shelfPin', 'hinge', 'drawerSlide', 'handleScrew',
] as const satisfies readonly BoreConnectorKind[];

describe('CONNECTOR_BOM_CATALOG — catalog completeness and shape', () => {
  it('contains an entry for every BoreConnectorKind', () => {
    for (const kind of ALL_KINDS) {
      expect(CONNECTOR_BOM_CATALOG[kind], `missing entry for ${kind}`).toBeDefined();
    }
  });

  it('each entry has the correct kind field matching its key', () => {
    for (const kind of ALL_KINDS) {
      expect(CONNECTOR_BOM_CATALOG[kind].kind).toBe(kind);
    }
  });

  it('each entry has a non-empty nameKey, nameEn, nameUk', () => {
    for (const kind of ALL_KINDS) {
      const e = CONNECTOR_BOM_CATALOG[kind];
      expect(e.nameKey.length).toBeGreaterThan(0);
      expect(e.nameEn.length).toBeGreaterThan(0);
      expect(e.nameUk.length).toBeGreaterThan(0);
    }
  });

  it('nameKey follows bom.connector.<kind> pattern', () => {
    for (const kind of ALL_KINDS) {
      expect(CONNECTOR_BOM_CATALOG[kind].nameKey).toBe(`bom.connector.${kind}`);
    }
  });

  it('notes may be empty string but must be a string', () => {
    for (const kind of ALL_KINDS) {
      expect(typeof CONNECTOR_BOM_CATALOG[kind].notes).toBe('string');
    }
  });

  it('confirmat entry matches contract literals exactly', () => {
    const e = CONNECTOR_BOM_CATALOG['confirmat'];
    expect(e.nameEn).toBe('Confirmat 7×50');
    expect(e.nameUk).toBe('Конфірмат 7×50');
    expect(e.notes).toBe('Ø7 face + Ø5 edge');
  });

  it('shelfPin entry matches contract literals exactly', () => {
    const e = CONNECTOR_BOM_CATALOG['shelfPin'];
    expect(e.nameEn).toBe('Shelf pin Ø5');
    expect(e.nameUk).toBe('Полицетримач Ø5');
    expect(e.notes).toBe('система-32');
  });

  it('hinge entry matches contract literals exactly', () => {
    const e = CONNECTOR_BOM_CATALOG['hinge'];
    expect(e.nameEn).toBe('Hinge Ø35 cup');
    expect(e.notes).toBe('+ 2 plate screws');
  });
});
