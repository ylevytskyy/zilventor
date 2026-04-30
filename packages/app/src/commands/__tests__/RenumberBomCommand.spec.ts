import { describe, it, expect } from 'vitest';
import { RenumberBomCommand } from '../RenumberBomCommand';
import { useAppStore } from '../../store/useAppStore';

describe('RenumberBomCommand', () => {
  it('resequences bomItemNumbers 1..N by partName ASC', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [
          { id: 'C1', partPath: 'parts/zelda.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
          { id: 'C2', partPath: 'parts/alpha.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
          { id: 'C3', partPath: 'parts/midway.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
        constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: { 'parts/zelda.zipt::none': 9 },
      },
    } as any);
    const partInfo = new Map([
      ['parts/alpha.zipt', { name: 'alpha' }],
      ['parts/midway.zipt', { name: 'midway' }],
      ['parts/zelda.zipt', { name: 'zelda' }],
    ]);
    await new RenumberBomCommand({ partInfo }).apply();
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map['parts/alpha.zipt::none']).toBe(1);
    expect(map['parts/midway.zipt::none']).toBe(2);
    expect(map['parts/zelda.zipt::none']).toBe(3);
  });
});
