import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';
import type { MaterialRegistry } from '@zilventor/shared/src/material';
import type { NestInputRow, NestState } from '@zilventor/shared';
import { packAllMaterials, computeNestFingerprint } from '@zilventor/shared';

export class GenerateNestCommand implements Command {
  readonly name = 'GenerateNest';
  private prevNest: NestState | undefined;
  private prevHadActiveAssembly = false;

  constructor(private readonly opts: {
    kerfMm: number;
    result: CutListResult;
    materials: MaterialRegistry;
  }) {}

  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    this.prevHadActiveAssembly = true;
    this.prevNest = a.nest;

    const inputRows: NestInputRow[] = this.opts.result.rows.map((r) => ({
      itemNumber: r.itemNumber, rowKey: r.rowKey, qty: r.qty,
      length: r.length, width: r.width,
      materialId: r.materialId, grain: r.grain,
    }));
    const { sheets, excluded } = packAllMaterials(inputRows, this.opts.materials, this.opts.kerfMm);
    const inputFingerprint = await computeNestFingerprint(this.opts.result.rows, this.opts.materials, this.opts.kerfMm);
    const nest: NestState = {
      params: { kerfMm: this.opts.kerfMm },
      generatedAt: Date.now(),
      inputFingerprint,
      sheets,
      excluded,
    };
    useAppStore.setState((s) => {
      if (!s.activeAssembly) return s;
      const nextDoc = { ...s.activeAssembly, nest };
      return {
        activeDocument: { kind: 'assembly' as const, document: nextDoc },
        activeAssembly: nextDoc,
      } as never;
    });
  }

  async revert(): Promise<void> {
    if (!this.prevHadActiveAssembly) return;
    useAppStore.setState((s) => {
      if (!s.activeAssembly) return s;
      const next = { ...s.activeAssembly };
      if (this.prevNest === undefined) {
        delete (next as { nest?: NestState }).nest;
      } else {
        next.nest = this.prevNest;
      }
      return {
        activeDocument: { kind: 'assembly' as const, document: next },
        activeAssembly: next,
      } as never;
    });
  }
}
