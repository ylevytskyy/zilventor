import type { Result } from '@zilventor/shared';
import { ok, err } from '@zilventor/shared';

export type MapPathError = string;

export function mapInputPathToOpfs(inputRelPath: string): Result<{ path: string }, MapPathError> {
  if (inputRelPath.startsWith('/')) return err(`absolute paths not allowed: ${inputRelPath}`);
  const segments = inputRelPath.split('/');
  if (segments.some((s) => s === '..' || s === '.')) return err(`. or .. segments not allowed: ${inputRelPath}`);

  let outName: string;
  if (inputRelPath.endsWith('.ipt.json')) {
    outName = inputRelPath.slice(0, -'.ipt.json'.length) + '.zipt';
  } else if (inputRelPath.endsWith('.iam.json')) {
    outName = inputRelPath.slice(0, -'.iam.json'.length) + '.ziasm';
  } else {
    return err(`unsupported extension (must be .ipt.json or .iam.json): ${inputRelPath}`);
  }
  return ok({ path: outName });
}

/** Returns a unique sibling path by appending __<hash> to the basename. */
export function avoidCollision(target: string, exists: (p: string) => boolean): string {
  if (!exists(target)) return target;
  const lastDot = target.lastIndexOf('.');
  const stem = lastDot >= 0 ? target.slice(0, lastDot) : target;
  const ext = lastDot >= 0 ? target.slice(lastDot) : '';
  for (let i = 0; i < 100; i++) {
    const hash = Math.random().toString(36).slice(2, 6);
    const candidate = `${stem}__${hash}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`avoidCollision: failed to find unique path after 100 attempts (${target})`);
}
