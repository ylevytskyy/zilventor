import { describe, it, expect } from 'vitest';
import type { SketchParameter } from '../parameters';

describe('SketchParameter type', () => {
  it('accepts the documented shape', () => {
    const samples: SketchParameter[] = [
      { name: 'd0',     expression: '50',          value: 50,    unit: 'mm'  },
      { name: 'width',  expression: 'd0',          value: 50,    unit: 'mm'  },
      { name: 'd1',     expression: 'd0 / 2',      value: 25,    unit: 'mm'  },
      { name: 'angle0', expression: '30',          value: 30,    unit: 'deg' }
    ];
    expect(samples).toHaveLength(4);
  });
});
