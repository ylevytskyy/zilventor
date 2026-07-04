# ABF Parity — Ratification Doc: Bore Face-Flip + Flip-Fence (TOP/BOT)

**Status:** OPTIONS DOC AWAITING USER ANSWERS — not a committed design. Source claims are
single-source, doc-tagged "(plausible)" (vendor tutorial titles only). Answer with single
letters, e.g. **"Q1=A, Q2=A, Q3=D, Q4=C"** — or better, a screenshot/description of the real
ABF dialog + a real flip-fence export, which supersedes everything below.

## 1. Doc claims vs verified code

The ABF doc (03-machining/02, "Face assignment (TOP/BOT)") makes two distinct claims:
(a) a post-placement **"flip face for the connector"** operation (ĐẢO MẶT CHO LIÊN KẾT);
(b) an exported colored **flip-fence reference line** (đường trục cắt ke lật mặt) for
re-registering a physically flipped panel on the CNC table. Mechanism/scope/axis: unknown.

Verified facts (direct code reads):
- `BoreOp.face.role ∈ {Top,Bottom,Front,Back,Left,Right}`; Top/Bottom = broad faces.
- `boreToFlat` ALREADY renders both faces on one per-panel drawing: Bottom → `(u, wid−v)` on
  BORES-BACK layers (v mirrors, u unchanged). Bottom-face bores are routine today
  (RIGHT_SIDE_INNER_FACE, DOOR_CUP_FACE) — face is baked at creation, no flip action exists.
- `EditBoreCommand` cannot edit `face.role` (numeric-only Pick).
- The NEST sheet DXF carries ZERO bore geometry — no second-side concept exists in nesting
  output at all.
- **P7's `PlacedPanel.mirrored` nest-editor flip is a DIFFERENT feature** (cosmetic visual
  toggle) — zero wiring to bores/DXF/CAM. Do not conflate.
- Additive-DXF-layer precedent: REMNANT (P7 W3) — conditional draw, no format bump.

## 2. Questions (single-letter answers)

**Q1 — What does "flip face for the connector" change?**
- A. Per-BORE toggle: one BoreOp.face.role Top↔Bottom. *(Recommended, conf 55 —
  most literal + cheapest; self-critique: the Vietnamese "CHO LIÊN KẾT" arguably favors B.)*
- B. Per-CONNECTOR swap: regenerate the joint with A/B member roles exchanged (both panels
  atomically).
- C. Handedness metadata flag only (which end gets 7mm vs 5mm) — no coordinate math.
- D. Skip until the real ABF dialog can be shown.

**Q2 — If geometric: which axis does the flip mirror across?**
- A. v' = vLen − v, u unchanged (flip about the LONG edge — the exact convention already in
  production in boreToFlat's Bottom rendering). *(Recommended, conf 65 — self-critique:
  that formula is a display convention, not a verified machine-table convention; they can
  differ.)*
- B. u' = uLen − u, v unchanged (flip about the SHORT edge).
- C. Both (180° in-plane rotation about center).
- D. Not a simple affine transform / defer.

**Q3 — What is the flip-fence line, concretely?**
- A. Per-PANEL line in the per-panel manufacturing DXF (REMNANT-precedent additive layer).
- B. Per-SHEET line in the nest DXF — implies whole-sheet two-sided passes; requires nesting
  output to carry bore geometry at all (a NEW capability, materially expensive).
- C. Text annotation only ("FLIP ALONG THIS EDGE") — cheapest, axis-agnostic.
- D. Skip — our per-panel DXF already reconciles both faces on one drawing; a fence may have
  no function in this pipeline. *(Recommended, conf 45 — self-critique: pure
  architecture-fit reasoning; if your shop really does two-sided full-sheet CNC passes,
  B is right and valuable — only your workflow answers this.)*

**Q4 — Build scope now?**
- A. Minimal reversible bore toggle now, accept semantic risk.
- B. Defer everything until firsthand ABF confirmation.
- C. Build only the bore-level primitive (per Q1/Q2 answers), skip the fence.
  *(Recommended, conf 50 — self-critique: even the "safe half" persists Q2's mirror guess
  into user data; wrong guess later = migration, not just a code fix.)*
- D. Build both fully now.

## 3. Per-answer implementation sketches (pre-designed)

- **Groundwork (answer-independent, BUILT 2026-07-04):** regression test pinning boreToFlat's
  Bottom-mirror formula; gap-analysis note distinguishing P7's cosmetic nest-flip from this
  claim.
- **Q1=A path:** pure `flipBoreFace(bore, panelDims)` in shared (Top↔Bottom + Q2 mirror,
  edited:true, broad-faces only) + new `FlipBoreFaceCommand` (EditBoreCommand
  snapshot/persist shape — NOT an EditBoreCommand patch: 3 fields change together and the
  DXF layer bucket moves) + BorePropertiesPanel "Flip face" button (broad faces only).
  Q2 variations isolate to ONE line inside flipBoreFace. No DXF changes (Bottom rendering
  already works); no format bump.
- **Q1=B path:** `FlipConnectorFaceCommand` via collectConnectorMembers + regenerate with A/B
  exchanged + mergeBores (preserves manual edits). 2–3× the footprint; build only on
  confirmation.
- **Q1=C path:** metadata `handedness?` field; smallest blast radius; judged unlikely.
- **Q3=A:** ~15–20 lines, MANUFACTURING_LAYERS.flipFence + conditional line along the Q2 edge.
  **Q3=B:** new capability (bores in nest DXF) — not cheap, scope separately. **Q3=C:** one
  doc.text call.

## §Planner self-critique (verbatim summary)

"What exists today" verified at ~90 conf by direct reads. The question set is genuinely
underdetermined — recommendations bias toward cheapest-to-build/already-precedented, which is
NOT evidence of correct ABF semantics. Biggest risk: Q1 (bore vs connector vs handedness) —
structurally different features, and no source disambiguates. Overall doc confidence: 72.
