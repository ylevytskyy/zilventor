export type EvaluationError =
  | { code: 'unknown-var'; name: string }
  | { code: 'cycle'; namesInCycle: string[] }
  | { code: 'parse-error'; message: string }
  | { code: 'div-by-zero' }
  | { code: 'non-finite' }
  | { code: 'name-in-use'; name: string }
  | { code: 'referenced'; name: string; referencedBy: string[] };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
