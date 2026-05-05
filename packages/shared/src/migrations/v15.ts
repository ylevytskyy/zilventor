// packages/shared/src/migrations/v15.ts
// v14 → v15: no-op.
// SectionView is forward-only: only created by AddSectionViewCommand.
// Existing part / assembly / drawing documents require no structural change.
export const MIGRATION_VERSION = 15 as const;
