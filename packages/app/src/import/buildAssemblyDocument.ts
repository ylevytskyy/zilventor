import type { AssemblyDocument, ComponentInstance, ComponentPath, ComponentColor, SketchParameter } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { ImporterAssemblyJson, ImporterParameter } from './inventorJsonSchema';
import { decodePose } from './poseDecode';

export type BuildAssemblyArgs = {
  asmJson: ImporterAssemblyJson;
  /** Map from sibling-relative ref (e.g. './Side.ipt.json') to OPFS path
   *  (e.g. 'Cabinet/Side.zipt'). Refs not in this map (or null refs) are
   *  treated as broken: partPath = '' so 4d's missing-part placeholder renders. */
  refResolution: Map<string, string>;
  asmId: string;
};

function sanitizeOccurrenceId(name: string): string {
  // Inventor occurrence names like 'SidePanel:1' must become file-path-safe.
  return name.replace(/[\\/:*?"<>| ]/g, '_');
}

function toSketchParameter(name: string, p: ImporterParameter): SketchParameter {
  switch (p.unit) {
    case 'mm':
      return { name, expression: p.expression, unit: 'mm', value: p.value };
    case 'deg':
      return { name, expression: p.expression, unit: 'deg', value: p.value };
    case 'rad':
      return {
        name,
        expression: `${p.expression} /* converted from rad */`,
        unit: 'deg',
        value: p.value * (180 / Math.PI),
      };
    case 'unitless':
      return { name, expression: p.expression, unit: 'mm', value: p.value };
  }
}

export function buildAssemblyDocument(args: BuildAssemblyArgs): AssemblyDocument {
  const { asmJson, refResolution, asmId } = args;
  const components: ComponentInstance[] = [];
  const colorOverrides: Record<string, ComponentColor> = {};
  const groundedPaths: ComponentPath[] = [];

  for (const occ of asmJson.occurrences) {
    const id = sanitizeOccurrenceId(occ.occurrenceName);
    const partPath = occ.ref == null ? '' : (refResolution.get(occ.ref) ?? '');
    const decoded = decodePose(occ.pose);
    const inst: ComponentInstance = {
      id,
      partPath,
      position: decoded.translation,
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: occ.visible,
      pose: { translation: decoded.translation, quaternion: decoded.quaternion },
      ...(occ.color ? { color: { kind: 'hex' as const, hex: occ.color.hex } } : {}),
    };
    components.push(inst);
    if (occ.grounded) groundedPaths.push([id]);
    if (occ.color) colorOverrides[pathKey([id])] = { kind: 'hex', hex: occ.color.hex };
  }

  const parameters: Record<string, SketchParameter> = {};
  for (const [k, v] of Object.entries(asmJson.parameters)) parameters[k] = toSketchParameter(k, v);

  return {
    id: asmId,
    name: asmJson.name,
    units: 'mm',
    parameters,
    components,
    constraints: [],
    groundedComponentPaths: groundedPaths,
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides,
    properties: { ...asmJson.properties },
    materials: [],
  };
}
