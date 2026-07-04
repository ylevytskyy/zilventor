import { describe, it, expect } from 'vitest';
import type { BoreOp } from '../bore';
import type { GrooveSpec, GrooveFeature } from '../groove';

describe('BoreOp — P3 W1 CAM fields (toolNumber/speed/presetLayerName)', () => {
  it('omits toolNumber/speed/presetLayerName when not set (exactOptionalPropertyTypes, absent-not-set)', () => {
    const bore: BoreOp = {
      id: 'b1', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
    };
    expect('toolNumber' in bore).toBe(false);
    expect('speed' in bore).toBe(false);
    expect('presetLayerName' in bore).toBe(false);
  });

  it('accepts toolNumber/speed/presetLayerName when explicitly set', () => {
    const bore: BoreOp = {
      id: 'b2', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
      toolNumber: 2, speed: 3200, presetLayerName: 'CONFIRMAT_D8',
    };
    expect(bore.toolNumber).toBe(2);
    expect(bore.speed).toBe(3200);
    expect(bore.presetLayerName).toBe('CONFIRMAT_D8');
  });
});

describe('BoreOp — sku field', () => {
  it('omits sku when not set (exactOptionalPropertyTypes, absent-not-set)', () => {
    const bore: BoreOp = {
      id: 'b1', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
    };
    expect('sku' in bore).toBe(false);
  });

  it('accepts sku when explicitly set', () => {
    const bore: BoreOp = {
      id: 'b2', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
      sku: 'BLUM-71B3550',
    };
    expect(bore.sku).toBe('BLUM-71B3550');
  });
});

describe('GrooveSpec/GrooveFeature — P3 W1 CAM fields', () => {
  it('GrooveSpec omits toolNumber/speed/presetLayerName when not set', () => {
    const spec: GrooveSpec = {
      faceRole: 'Back', axis: 'u', position: 50, width: 8, depth: 6,
    };
    expect('toolNumber' in spec).toBe(false);
    expect('speed' in spec).toBe(false);
    expect('presetLayerName' in spec).toBe(false);
  });

  it('GrooveFeature accepts toolNumber/speed/presetLayerName when explicitly set', () => {
    const feature: GrooveFeature = {
      kind: 'groove', id: 'g1',
      faceRole: 'Back', axis: 'u', position: 50, width: 8, depth: 6,
      toolNumber: 5, speed: 2800, presetLayerName: 'GROOVE_D8',
    };
    expect(feature.toolNumber).toBe(5);
    expect(feature.speed).toBe(2800);
    expect(feature.presetLayerName).toBe('GROOVE_D8');
  });
});
