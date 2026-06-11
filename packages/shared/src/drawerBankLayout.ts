export interface Slot { index: number; bottomZ: number; topZ: number; }

export function drawerBankLayout(opening: { openBottomZ: number; openH: number }, n: number): Slot[] {
  if (n < 1) throw new Error('drawer count must be ≥ 1');
  const h = opening.openH / n;
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    bottomZ: opening.openBottomZ + i * h,
    topZ: opening.openBottomZ + (i + 1) * h,
  }));
}
