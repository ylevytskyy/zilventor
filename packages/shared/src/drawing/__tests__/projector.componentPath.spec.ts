import { describe, it, expect } from 'vitest';
import { projectView, type ProjectorInput } from '../projector';

describe('projectView carries componentPath', () => {
  it('copies componentPath from input edge onto every output Edge2D', () => {
    // A single front-facing triangle + one edge tagged with a component path.
    const input: ProjectorInput = {
      triangles: [[[0, 0, 0], [10, 0, 0], [0, 10, 0]]],
      edges: [
        { id: 'e1', points: [[0, 0, 0], [10, 0, 0]], componentPath: 'root/cabinet#0' },
      ],
      bbox: [0, 0, -1, 10, 10, 1] as never,
    };
    const out = projectView(input, 'front');
    const all = [...out.visibleEdges, ...out.hiddenEdges];
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) expect(e.componentPath).toBe('root/cabinet#0');
  });

  it('leaves componentPath undefined when input edge has none', () => {
    const input: ProjectorInput = {
      triangles: [[[0, 0, 0], [10, 0, 0], [0, 10, 0]]],
      edges: [{ id: 'e1', points: [[0, 0, 0], [10, 0, 0]] }],
      bbox: [0, 0, -1, 10, 10, 1] as never,
    };
    const out = projectView(input, 'front');
    for (const e of [...out.visibleEdges, ...out.hiddenEdges]) {
      expect(e.componentPath).toBeUndefined();
    }
  });
});
