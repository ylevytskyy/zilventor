import type { Command } from './Command';
import type { SketchParameter } from '@zilventor/shared';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

export class UpdateParameterExpressionCommand implements Command {
  readonly name = 'UpdateParameterExpression';

  constructor(
    private before: SketchParameter,
    private afterExpr: string,
    private registry: ParameterRegistry
  ) {}

  async apply(): Promise<void> {
    const result = this.registry.setParameter({
      name: this.before.name,
      expression: this.afterExpr,
      unit: this.before.unit,
    });
    if (!result.ok) {
      throw new Error(`UpdateParameterExpressionCommand.apply failed: ${JSON.stringify(result.error)}`);
    }
  }

  async revert(): Promise<void> {
    const result = this.registry.setParameter({
      name: this.before.name,
      expression: this.before.expression,
      unit: this.before.unit,
    });
    if (!result.ok) {
      throw new Error(`UpdateParameterExpressionCommand.revert failed: ${JSON.stringify(result.error)}`);
    }
  }
}
