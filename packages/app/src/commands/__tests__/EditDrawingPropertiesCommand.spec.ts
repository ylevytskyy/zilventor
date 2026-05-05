// packages/app/src/commands/__tests__/EditDrawingPropertiesCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EditDrawingPropertiesCommand } from '../EditDrawingPropertiesCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeDrawingDoc(properties: Record<string, string | number | boolean> = {}): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: {
      kind: 'drawing',
      document: makeDrawingDoc({ author: 'Alice', version: 1, approved: false }),
    },
  } as never);
});

describe('EditDrawingPropertiesCommand', () => {
  it('(a) apply replaces the drawing-level properties', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob', version: 2, approved: true, notes: 'Rev B' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.properties['author']).toBe('Bob');
    expect(doc.properties['version']).toBe(2);
    expect(doc.properties['approved']).toBe(true);
    expect(doc.properties['notes']).toBe('Rev B');
  });

  it('(a) apply is a full replacement — keys absent from new properties are removed', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.properties['author']).toBe('Bob');
    expect(doc.properties['version']).toBeUndefined();
    expect(doc.properties['approved']).toBeUndefined();
  });

  it('(b) revert restores the prior properties', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob', version: 2 },
    });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.properties['author']).toBe('Alice');
    expect(doc.properties['version']).toBe(1);
    expect(doc.properties['approved']).toBe(false);
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob' },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.properties['author']).toBe('Alice');
    expect(doc.properties['version']).toBe(1);
  });
});
