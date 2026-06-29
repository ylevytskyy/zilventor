// @vitest-environment node
/**
 * Structural tests for the auto-explode multi-color STEP branch in FileTab.
 * Uses source-text inspection (same convention as FileTab.export.spec.ts) because
 * FileTab calls browser APIs (showOpenFilePicker, Opfs, etc.) that aren't available
 * in jsdom and would require heavy mocking.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const FILE_TAB_PATH = path.resolve(__dirname, '../FileTab.tsx');

async function src(): Promise<string> {
  return fs.readFile(FILE_TAB_PATH, 'utf-8');
}

describe('FileTab — auto-explode multi-color STEP', () => {
  it('imports shouldAutoExplode from autoExplodeHeuristic', async () => {
    expect(await src()).toContain('shouldAutoExplode');
  });

  it('references ExplodeIntoAssemblyCommand (dynamic import in the STEP branch)', async () => {
    expect(await src()).toContain('ExplodeIntoAssemblyCommand');
  });

  it('calls setShowComponentColors after the explode', async () => {
    expect(await src()).toContain('setShowComponentColors');
  });
});
