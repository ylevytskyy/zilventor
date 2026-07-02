export type GridItemSize = { width: number; height: number };
export type GridPosition = { x: number; y: number };

/**
 * Row-wrapped grid layout for packing N same-purpose units (panels / nest sheets)
 * into one combined DXF document.
 *
 * columns = Math.ceil(Math.sqrt(n)); items are placed left→right filling each row
 * before wrapping to the next. Growth direction: rows grow monotonically along +Y
 * (the first row sits at y=0, later rows sit at strictly larger y) — i.e. the grid
 * grows "upward" in DXF's Y-up convention, never negative.
 *
 * Column advance = current item's width + gutter. Row advance = the MAX height seen
 * across all items in that row + gutter (so a row never clips its tallest member).
 */
export function layoutCombinedGrid(
  items: ReadonlyArray<GridItemSize>,
  gutter: number,
): GridPosition[] {
  if (items.length === 0) return [];
  const cols = Math.ceil(Math.sqrt(items.length));

  const positions: GridPosition[] = [];
  let x = 0;
  let y = 0;
  let col = 0;
  let rowMaxHeight = 0;

  for (const item of items) {
    positions.push({ x, y });
    rowMaxHeight = Math.max(rowMaxHeight, item.height);
    col++;
    if (col >= cols) {
      col = 0;
      x = 0;
      y += rowMaxHeight + gutter;
      rowMaxHeight = 0;
    } else {
      x += item.width + gutter;
    }
  }
  return positions;
}
