export type KernelErrorKind =
  | 'degenerateSketch'
  | 'invalidParameter'
  | 'invalidGeometry'
  | 'booleanFailed'
  | 'revolveFailed'
  | 'filletFailed'
  | 'edgeNotFound'
  | 'oom'
  | 'workerCrashed'
  | 'fileFormatTooNew'
  | 'fileCorrupt'
  | 'featureNotFound'
  | 'unknown';

export type KernelError = {
  kind: KernelErrorKind;
  message: string;
  correlationId: string;
  featureId?: string;
  occtCode?: string;
};

export const newCorrelationId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
