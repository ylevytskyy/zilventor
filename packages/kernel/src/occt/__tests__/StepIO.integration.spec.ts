import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { readStep } from '../StepIO';
import { disposeShape } from '../SolidOps';

const FIXTURES = resolve(__dirname, 'fixtures/step');

describe('readStep (integration)', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); });

  it('reads cube-10mm.step into a single solid with 6 faces and bbox [0,0,0,10,10,10]', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'cube-10mm.step'));
    const result = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      expect(result.faceCount).toBe(6);
      expect(result.solidCount).toBe(1);
      expect(result.boundingBox[0]).toBeCloseTo(0, 5);
      expect(result.boundingBox[1]).toBeCloseTo(0, 5);
      expect(result.boundingBox[2]).toBeCloseTo(0, 5);
      expect(result.boundingBox[3]).toBeCloseTo(10, 5);
      expect(result.boundingBox[4]).toBeCloseTo(10, 5);
      expect(result.boundingBox[5]).toBeCloseTo(10, 5);
    } finally {
      disposeShape(result.shape);
    }
  });

  it('reads cube-10mm.step as manifold (isManifold: true)', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'cube-10mm.step'));
    const result = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      expect(result.isManifold).toBe(true);
    } finally {
      disposeShape(result.shape);
    }
  });

  it('reads two-bodies.step with 12 faces and 2 solids', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'two-bodies.step'));
    const result = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      expect(result.faceCount).toBe(12);
      expect(result.solidCount).toBe(2);
    } finally {
      disposeShape(result.shape);
    }
  });

  it('reads cyrillic-name.step without throwing', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'cyrillic-name.step'));
    const result = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      expect(result.faceCount).toBe(6);
    } finally {
      disposeShape(result.shape);
    }
  });

  it('throws a descriptive error for non-STEP bytes', () => {
    const garbage = new TextEncoder().encode('not a step file');
    expect(() => readStep(oc, garbage.buffer.slice(garbage.byteOffset, garbage.byteOffset + garbage.byteLength))).toThrow(/STEP|read|parse|empty/i);
  });
});
