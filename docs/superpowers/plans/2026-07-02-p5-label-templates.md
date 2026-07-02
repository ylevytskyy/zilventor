# P5 — Label templates + header presets (R5.1, R5.2)

Branch: `feat/p5-label-templates`. Parent plan: `2026-07-02-abf-parity-milestones.md` (P5).

## Requirements (docs/abf-plugin/05-parity/03-processing-parity-requirements.md)

- **R5.1** — Label print supports at least two selectable templates: a standard shop tag and a QR-enabled variant (template *selection*; QR already ships).
- **R5.2** — Label header/free-text fields (e.g. job name, company name) savable as named, reusable presets, editable and deletable independent of any single job.
- **Acceptance** — Label export offers a template selector with ≥2 options; a saved header preset survives a document reload.

## Design (minimal)

- `LabelTemplateId = 'rich' | 'compact'` exported from `renderLabelsPdf.ts`. `renderLabelsPdf(labels, opts?)` with `RenderLabelsPdfOptions { layout?, templateId?, headerLine1?, headerLine2? }`; no-opts call is byte-identical to today (regression-safe; no caller passes the old positional layout).
- **rich** = current cell unchanged; **compact** = no mini diagram, enlarged QR, reflowed text. Header band = 2 lines drawn in the existing 10 mm top margin of every page when non-empty; `LABEL_LAYOUT`/`labelCellRect` untouched.
- `LabelHeaderPreset { id, name, line1, line2 }` in `packages/app/src/store/labelHeaderPreset.ts`; localStorage key `labelHeaderPresets`; CRUD actions + dialog toggle in `useAppStore`, mirroring machining presets (ADR 0001 pattern).
- Session-only store fields: `labelTemplate`, `labelHeaderLine1/2` + setters (mirrors `dxfExportMode`).
- UI: `LabelHeaderPresetsDialog` (CRUD, no import/export) wired via `WorkFeatureDialogsHost`; Furniture ribbon gains rich/compact toggle, 2 header inputs, load-preset select, manage-presets button; `ExportPanelLabelsCommand` forwards options via conditional spread (`exactOptionalPropertyTypes`).
- No document/manifest field; **no version bump**. No undo (app-global state, machining-presets precedent).
- Known pre-existing limitation (not fixed here): jsPDF core font has no Cyrillic glyphs — Ukrainian header text renders garbled, same as materialName/partName today.

## Scope calls (user AFK — proceeding on recommendation; veto = revisit)

- **S1**: No JSON import/export for header presets (R5.2 asks only save/edit/delete; unlike machining presets which needed shop-wide portability). Confidence 80.
- **S2**: Template choice + live header-line text are session-only (NOT localStorage); only named presets persist. Matches `dxfExportMode` precedent; R5.2's reload-survival wording applies to presets only. Cheap to add persistence later. Confidence 75.
- **S3**: No new Playwright spec for the controls; store-level `vi.resetModules()` reload-simulation test is the R5.2 acceptance evidence (P3 precedent). Existing `panel-labels.spec.ts` e2e must stay green (defaults reproduce today's output); full e2e runs at merge gate. Confidence 70.

## Slices

- [x] **W1 — store slice**: `labelHeaderPreset.ts` type + `useAppStore` CRUD/persist + session fields + spec (incl. reload-simulation + malformed-JSON + session-fields-not-persisted). 9/9 specs.
- [x] **W2 — renderer**: template dispatch (rich/compact) + header band as pure stub-tested functions; existing renderLabelsPdf/labelDiagram/labelCellRect specs stay green untouched. (Parallel with W1.) 26/26 drawing specs.
- [x] **W3 — dialog**: `LabelHeaderPresetsDialog` CRUD + spec + one-line `WorkFeatureDialogsHost` wiring. Hardcoded EN strings + `TODO(i18n)` comments for W4. (After W1.) 6/6 specs.
- [x] **W4 — ribbon + command + i18n**: FurnitureTab controls, `ExportPanelLabelsCommand` option threading, ALL i18n keys en+uk (incl. W3's TODOs). (After W1–W3.) 17/17 specs; 12 keys en+uk.

## Gate (before `--no-ff` merge to local master)

typecheck 0 across packages · app/shared/kernel unit suites at baseline+new · fresh-server e2e (panel-labels spec green; fix any "exactly N entries"-style assertions broken by deliberate new ribbon controls in tests, not product).

**Gate results (2026-07-02, EXEC): PASS.** typecheck 0 ×5 pkgs · app 3408 (baseline 3376, +32) / shared 1414 / kernel 306, 0 failures · e2e 228/231 parallel, panel-labels green solo; 1 load-flake (auto-regen, passes serial); 2 deterministic failures PRE-EXISTING and unrelated to P5 (spec files byte-identical to master, zero diff overlap): `drag-gizmo.spec.ts:27` (lastCmd GenerateCarcassBores ≠ MoveConnector) and `drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts:26` (pointer kind is part) — need their own debug-loop, not P5 scope · i18n parity 12/12 keys both locales, no untranslated copy-paste, zero TODO(i18n).
