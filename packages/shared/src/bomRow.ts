import type { AssemblyDocument, ComponentColor, ComponentInstance } from './types';

export function bomRowKey(partPath: string, color?: ComponentColor): string {
  if (!color) return `${partPath}::none`;
  if (color.kind === 'palette') return `${partPath}::palette:${color.name}`;
  return `${partPath}::hex:${color.hex.toLowerCase()}`;
}

export type BomRow = {
  rowKey: string;
  itemNumber: number;
  qty: number;
  partPath: string;
  partName: string;
  color: ComponentColor | undefined;
  componentIds: string[];
};

function effectiveColor(c: ComponentInstance, palette: Record<string, string>): ComponentColor | undefined {
  if (!c.color) return undefined;
  if (c.color.kind === 'palette' && !(c.color.name in palette)) return undefined;
  return c.color;
}

export function aggregateBom(assembly: AssemblyDocument, partNames: Map<string, string>): BomRow[] {
  const groups = new Map<string, { partPath: string; color: ComponentColor | undefined; componentIds: string[] }>();
  for (const c of assembly.components) {
    const color = effectiveColor(c, assembly.colors);
    const rowKey = bomRowKey(c.partPath, color);
    const g = groups.get(rowKey);
    if (g) g.componentIds.push(c.id);
    else groups.set(rowKey, { partPath: c.partPath, color, componentIds: [c.id] });
  }
  const existing = assembly.bomItemNumbers;
  const usedNumbers = new Set(Object.values(existing));
  let nextNumber = (usedNumbers.size === 0 ? 0 : Math.max(...usedNumbers)) + 1;
  const rows: BomRow[] = [];
  for (const [rowKey, g] of groups) {
    let itemNumber = existing[rowKey];
    if (itemNumber === undefined) {
      itemNumber = nextNumber++;
    }
    rows.push({
      rowKey,
      itemNumber,
      qty: g.componentIds.length,
      partPath: g.partPath,
      partName: partNames.get(g.partPath) ?? '(missing part)',
      color: g.color,
      componentIds: [...g.componentIds],
    });
  }
  rows.sort((a, b) => a.itemNumber - b.itemNumber);
  return rows;
}

export function compareBomRowsForRenumber(a: BomRow, b: BomRow): number {
  if (a.partName !== b.partName) return a.partName < b.partName ? -1 : 1;
  if (a.rowKey !== b.rowKey) return a.rowKey < b.rowKey ? -1 : 1;
  return 0;
}

export function pruneBomItemNumbers(assembly: AssemblyDocument): Record<string, number> {
  const live = new Set<string>();
  for (const c of assembly.components) {
    const color = effectiveColor(c, assembly.colors);
    live.add(bomRowKey(c.partPath, color));
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(assembly.bomItemNumbers)) {
    if (live.has(k)) out[k] = v;
  }
  return out;
}
