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
        constraints: [], groundedComponentIds: [],
        colors: {}, bomItemNumbers: { 'parts/zelda.zipt::none': 9 },
      },
    } as any);
    const partNames = new Map([
      ['parts/alpha.zipt', 'alpha'],
      ['parts/midway.zipt', 'midway'],
      ['parts/zelda.zipt', 'zelda'],
    ]);
    await new RenumberBomCommand({ partNames }).apply();
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map['parts/alpha.zipt::none']).toBe(1);
    expect(map['parts/midway.zipt::none']).toBe(2);
    expect(map['parts/zelda.zipt::none']).toBe(3);
  });
});
