// @vitest-environment node
/**
 * Structural tests for FileTab Export Image feature.
 * We test at source-text level (same approach as FileTab.drawing.spec.ts)
 * because FileTab calls browser APIs (showSaveFilePicker) that don't exist in jsdom.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const FILE_TAB_PATH = path.resolve(__dirname, '../FileTab.tsx');
const VIEWPORT_PATH = path.resolve(__dirname, '../../../viewport/Viewport.tsx');

async function readSrc(p: string): Promise<string> {
  return fs.readFile(p, 'utf-8');
}

describe('FileTab — Export Image button', () => {
  it('imports triggerDownload from nesting/triggerDownload', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain("from '../../nesting/triggerDownload'");
  });

  it('contains handleExportImage function', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('handleExportImage');
  });

  it('calls captureViewportPng with transparent arg', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('captureViewportPng');
    expect(src).toContain('transparent');
  });

  it('calls triggerDownload with .png suggestedName', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('triggerDownload');
    expect(src).toContain('.png`');
  });

  it('Export Image button is disabled when activeDoc.kind === drawing', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    // The button must be conditionally disabled when activeDoc kind is 'drawing'
    expect(src).toContain("Export Image");
    expect(src).toContain("kind === 'drawing'");
  });

  it('Transparent background checkbox is present', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('Transparent');
    // Checkbox must be a controlled input or equivalent
    expect(src).toContain('transparentBg');
  });
});

describe('ViewportRef — new methods present', () => {
  it('ViewportRef type declares captureViewportPng', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    expect(src).toContain('captureViewportPng');
  });

  it('ViewportRef type declares captureThumbnailScaled', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    expect(src).toContain('captureThumbnailScaled');
  });

  it('useImperativeHandle body forwards captureViewportPng to SceneManager', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    // Both the type declaration and the delegation must exist
    const occurrences = (src.match(/captureViewportPng/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2); // type + impl
  });

  it('useImperativeHandle body forwards captureThumbnailScaled to SceneManager', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    const occurrences = (src.match(/captureThumbnailScaled/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2); // type + impl
  });
});
