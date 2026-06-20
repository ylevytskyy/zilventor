import type { Configuration } from '@zilventor/shared';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

/**
 * Activates a named iPart configuration by bulk-setting its parameter values on
 * the registry. All writes are wrapped in a single `registry.batch(...)` so the
 * cascade fires exactly one subscriber notification (avoids N re-executes — one
 * per parameter). Each parameter inherits its existing unit (default 'mm').
 *
 * Returns true when the configuration was found and applied, false when no
 * configuration with `name` exists (in which case nothing is written).
 */
export function activateConfiguration(
  registry: ParameterRegistry,
  configurations: Configuration[],
  name: string
): boolean {
  const cfg = configurations.find((c) => c.name === name);
  if (!cfg) return false;
  registry.batch(() => {
    for (const [param, expression] of Object.entries(cfg.values)) {
      const existing = registry.getAll().find((p) => p.name === param);
      const unit = existing?.unit ?? 'mm';
      registry.setParameter({ name: param, expression, unit });
    }
  });
  return true;
}
