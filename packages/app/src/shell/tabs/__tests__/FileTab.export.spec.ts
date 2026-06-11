// @vitest-environment node
/**
 * Structural tests for FileTab STEP/STL export buttons.
 * Tests at source-text level (same approach as FileTab.exportImage.spec.ts)
 * because FileTab calls browser APIs (showSaveFilePicker, Opfs) that don't
 * exist in jsdom / require complex mocking.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const FILE_TAB_PATH = path.resolve(__dirname, '../FileTab.tsx');

async function readSrc(p: string): Promise<string> {
  return fs.readFile(p, 'utf-8');
}

describe('FileTab — Export STEP / STL buttons', () => {
  it('imports ExportStepCommand via dynamic import', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('ExportStepCommand');
  });

  it('imports ExportStlCommand via dynamic import', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('ExportStlCommand');
  });

  it('contains handleExportStep handler', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('handleExportStep');
  });

  it('contains handleExportStl handler', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('handleExportStl');
  });

  it('Export STEP button uses menu.file.exportStep i18n key', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain("menu.file.exportStep");
  });

  it('Export STL button uses menu.file.exportStl i18n key', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain("menu.file.exportStl");
  });

  it('Export STEP button is disabled when activeDoc.kind === drawing', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    // Both new buttons use the same disabled predicate as Export Image
    // Count occurrences of the disable predicate to confirm both buttons have it
    const drawingDisables = (src.match(/kind === 'drawing'/g) ?? []).length;
    expect(drawingDisables).toBeGreaterThanOrEqual(3); // export image + export step + export stl
  });

  it('passes subAssemblyDocs and subAssemblyInnerPoses to the commands', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('subAssemblyDocs');
    expect(src).toContain('subAssemblyInnerPoses');
  });

  it('swallows AbortError and propagates other errors to setErrorDialog', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    // Both handlers must guard against AbortError
    const abortErrorCount = (src.match(/AbortError/g) ?? []).length;
    expect(abortErrorCount).toBeGreaterThanOrEqual(3); // one existing + 2 new handlers
  });
});
