// tests/perf/_fixtures.ts
// Shared fixture helpers for perf specs.

/** Build a flat 20-component assembly (5×4 grid of 50×50×30 mm boxes). */
export function buildPerfAssembly20(): { components: Array<{ path: string; positionMm: { x: number; y: number; z: number } }> } {
  const components = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      components.push({
        path: `parts/box_${row}_${col}.zipt`,
        positionMm: { x: col * 60, y: 0, z: row * 40 },
      });
    }
  }
  return { components };
}
