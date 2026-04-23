import { describe, it, expect } from 'vitest';
import { createCommandBus } from '../CommandBus';
import type { Command } from '../Command';

describe('CommandBus', () => {
  it('applies, undoes, and redoes a counter command', async () => {
    let n = 0;
    const inc = (by: number): Command => ({
      name: 'inc',
      apply: async () => { n += by; },
      revert: async () => { n -= by; }
    });
    const bus = createCommandBus();
    await bus.execute(inc(2));
    await bus.execute(inc(3));
    expect(n).toBe(5);
    await bus.undo(); expect(n).toBe(2);
    await bus.undo(); expect(n).toBe(0);
    await bus.redo(); expect(n).toBe(2);
    await bus.redo(); expect(n).toBe(5);
  });

  it('clears redo stack on new apply', async () => {
    let n = 0;
    const inc = (by: number): Command => ({ name: 'inc', apply: async () => { n += by; }, revert: async () => { n -= by; } });
    const bus = createCommandBus();
    await bus.execute(inc(2));
    await bus.undo();
    await bus.execute(inc(5));
    expect(await bus.redo()).toBe(false);
    expect(n).toBe(5);
  });

  it('undo returns false when stack empty, redo likewise', async () => {
    const bus = createCommandBus();
    expect(await bus.undo()).toBe(false);
    expect(await bus.redo()).toBe(false);
  });

  it('canUndo and canRedo reflect stack state', async () => {
    let _n = 0;
    const bus = createCommandBus();
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(false);
    await bus.execute({ name: 'x', apply: async () => { _n += 1; }, revert: async () => { _n -= 1; } });
    expect(bus.canUndo()).toBe(true);
    expect(bus.canRedo()).toBe(false);
    await bus.undo();
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(true);
  });
});
