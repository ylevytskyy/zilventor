# CLAUDE.md — zilventor

Project-specific guidance; overrides global rules where it conflicts.

## Verification posture

Deterministic-first: per-package unit suites + root typecheck before any LLM judgment; a
change touching product code is not done until the affected e2e surface ran green on a fresh
dev server. Baselines (verify against, 2026-07-05): e2e 243/243 · app 3833 · shared 1633 ·
kernel 306 unit + 380/381 integration · typecheck 0 across 5 packages.

## Prerequisites

- Node.js ≥ 20
- pnpm 9.x

## Local verification

1. **Static checks** — `pnpm typecheck` from root (all 5 packages). Root `pnpm lint` OOMs on
   the whole monorepo (pre-existing) — use scoped `npx eslint <files>` instead.
2. **Unit / integration tests** — per-package ONLY: `cd packages/<p> && npx vitest run`.
   Bare `pnpm --filter <pkg> test` silently no-ops; root vitest is broken. Kernel integration
   (real OCCT wasm) runs via its own vitest config (`test:integration`), ~seconds not minutes.
3. **Build** — `pnpm build`
4. **E2E** — `pnpm exec playwright test --project=chromium` from root. Full suite needs two
   shards under a 600s timeout each: `--shard=1/2` then `--shard=2/2`.
   **Never `pnpm test:e2e -- --shard=…`** — pnpm mangles the `=` and playwright finds no tests.
   Before judging results: kill stray processes (`pkill -f playwright; pkill -f
   chrome-headless; lsof -ti:5173 | xargs kill -9`) — overlapping auto-backgrounded runs and
   stale-HMR dev servers both produce false failures.

## Notes / gotchas

- **E2E style:** poll settled end state (`expect.poll` / `waitForFunction`), never
  `waitForTimeout` — the whole flake history of this suite is fixed-sleep races. Headless
  viewport renders BLACK: no visual 3D assertions; probe via OPFS bytes + kernel re-load
  (triangleCount for topology; `positionsSum` vertex fingerprint when triangle count is
  invariant or — keyholeSlot — unreliable). Access the store via the `window.__zilventorStore`
  hook, never a dynamic `import('/src/store/useAppStore')` (stale Vite HMR module binding).
- **New manifest field/kind:** bump `CURRENT_FORMAT_VERSION` + no-op migration entry +
  normalizeKind OR-list gets the new version + fixture sweep (~30 files assert `.toBe(N)`;
  beware input-literal false positives). Current: v41.
- **TypeScript:** `exactOptionalPropertyTypes: true` — conditional spreads; undo must restore
  key ABSENCE (destructuring-omit + full-object write; the shallow-merge reducer can't delete).
  `@types/react` 18 needs `MutableRefObject` for writable refs.
- **Face vocabulary:** `Top`/`Bottom` are the two LARGE thickness-normal faces;
  `Front`/`Back`/`Left`/`Right` are narrow edge faces (no flat-drawing DXF representation).
- **Poses:** `ComponentInstance.pose` (additive) wins over `rotation` via
  `componentLocalPose` — templates' stored `position`/`rotation` numbers are load-bearing for
  the bore/joint pipeline (`GenerateCarcassBoresCommand`'s synthetic frame); never change them,
  add `pose` instead. Manual position/rotation edits must delete `pose` (EditComponentCommand).
- **Undo:** UI actions that mutate document state dispatch `bus.execute(cmd)`, never direct
  `.apply()`. Commands whose setters have conflict-bump side effects snapshot the WHOLE map.
- **Tests env:** jsdom lacks `PointerEvent` (drive drags via MouseEvent helpers); keep the
  in-memory Storage shim in test-setup (Node 25).
- **i18n:** en.json/uk.json change together, single owner per parallel dispatch.
- **Git:** master is protected — feature branch + `--no-ff` merge to LOCAL master is the
  autonomous end-state; pushes to master are user-only. `git switch` and `git push` in
  separate commands.
