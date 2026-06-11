import type { BoreConnectorKind } from './bore';

export interface ConnectorBomEntry {
  kind: BoreConnectorKind;
  /** i18n key; e.g. 'bom.connector.confirmat' */
  nameKey: string;
  /** Static English fallback in case i18n is unavailable. */
  nameEn: string;
  /** Static Ukrainian first-draft fallback. */
  nameUk: string;
  notes: string;   // e.g. 'Ø7 face + Ø5 edge'
}

/** Keyed by BoreConnectorKind for O(1) lookup. */
export const CONNECTOR_BOM_CATALOG: Record<BoreConnectorKind, ConnectorBomEntry> = {
  confirmat:   { kind: 'confirmat',   nameKey: 'bom.connector.confirmat',   nameEn: 'Confirmat 7×50',      nameUk: 'Конфірмат 7×50',    notes: 'Ø7 face + Ø5 edge'  },
  minifix:     { kind: 'minifix',     nameKey: 'bom.connector.minifix',     nameEn: 'Minifix cam fitting', nameUk: 'Стяжка Minifix',    notes: 'cam+cross+bolt'      },
  dowel:       { kind: 'dowel',       nameKey: 'bom.connector.dowel',       nameEn: 'Dowel Ø8',            nameUk: 'Шкант Ø8',          notes: '2 bores'             },
  shelfPin:    { kind: 'shelfPin',    nameKey: 'bom.connector.shelfPin',    nameEn: 'Shelf pin Ø5',        nameUk: 'Полицетримач Ø5',   notes: 'система-32'          },
  hinge:       { kind: 'hinge',       nameKey: 'bom.connector.hinge',       nameEn: 'Hinge Ø35 cup',       nameUk: 'Завіса Ø35',        notes: '+ 2 plate screws'    },
  drawerSlide: { kind: 'drawerSlide', nameKey: 'bom.connector.drawerSlide', nameEn: 'Drawer slide Ø5',     nameUk: 'Напрямна ящика Ø5', notes: 'система-32 Ø5 blind' },
};
