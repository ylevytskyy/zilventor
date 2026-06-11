import type { Command } from './Command';

export type CommandBus = {
  execute(cmd: Command): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Slice-5 e2e probe: name of the most-recently executed command, or null if stack empty. */
  lastExecutedName(): string | null;
};

export function createCommandBus(): CommandBus {
  const undoStack: Command[] = [];
  const redoStack: Command[] = [];
  return {
    async execute(cmd) {
      await cmd.apply();
      undoStack.push(cmd);
      redoStack.length = 0;
    },
    async undo() {
      const cmd = undoStack.pop();
      if (!cmd) return false;
      await cmd.revert();
      redoStack.push(cmd);
      return true;
    },
    async redo() {
      const cmd = redoStack.pop();
      if (!cmd) return false;
      await cmd.apply();
      undoStack.push(cmd);
      return true;
    },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },
    lastExecutedName() { return undoStack[undoStack.length - 1]?.name ?? null; },
  };
}
