import type { Configuration, SketchParameter } from '@zilventor/shared';

/**
 * Builds a named configuration that captures the current parameter expressions —
 * used by "Add Row" to clone the active design state into a new configuration.
 */
export function configurationFromParameters(
  name: string,
  parameters: SketchParameter[]
): Configuration {
  const values: Record<string, string> = {};
  for (const p of parameters) values[p.name] = p.expression;
  return { name, values };
}
