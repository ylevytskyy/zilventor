export interface Slot { index: number; bottomZ: number; topZ: number; }

export function drawerBankLayout(
  opening: { openBottomZ: number; openH: number },
  n: number,
  heights?: number[],
): Slot[] {
  if (n < 1) throw new Error('drawer count must be ≥ 1');

  if (heights === undefined) {
    const h = opening.openH / n;
    return Array.from({ length: n }, (_, i) => ({
      index: i,
      bottomZ: opening.openBottomZ + i * h,
      topZ: opening.openBottomZ + (i + 1) * h,
    }));
  }

  if (heights.length !== n) {
    throw new Error(
      `drawerBank.error.heightCount: expected ${n} heights, got ${heights.length}`,
    );
  }
  const sum = heights.reduce((acc, v) => acc + v, 0);
  if (Math.abs(sum - opening.openH) > 0.5) {
    throw new Error(
      `drawerBank.error.heightSum: heights sum to ${sum}mm, opening is ${opening.openH}mm`,
    );
  }

  const slots: Slot[] = [];
  let cursor = opening.openBottomZ;
  for (let i = 0; i < n; i++) {
    const bottomZ = cursor;
    const topZ = bottomZ + heights[i]!;
    slots.push({ index: i, bottomZ, topZ });
    cursor = topZ;
  }
  return slots;
}
