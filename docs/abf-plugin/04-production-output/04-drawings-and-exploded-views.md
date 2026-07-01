# Working Drawings and Exploded Views

ABF has no dedicated drawing-generation subsystem. What it has instead is a thin, embedded-in-the-model documentation pass: labels stamped onto panel faces, a printable shop tag, and one free exploded-view tool that leans on SketchUp's own export command for output. This doc describes what that free tier actually does, and flags a serious caveat — the exploded-view tool mutates the model it runs on — that matters for how ZilInventor scopes its own (already richer) drawing system against ABF.

## Marking/labeling as the validity gate for downstream export

Розмітка (rozmitka — "marking/labeling") is the same labeling pass introduced in [03-labels-and-reports.md](03-labels-and-reports.md). It stamps each panel with:

| Field | Source |
|---|---|
| Part name | From the panel's group name |
| Sequential part number | Auto-incremented ("деталь номер 1, 2, 3...") |
| Company name | Optional, pulled from plugin settings |
| Grain-direction arrow | Derived from panel orientation/material grain |

This text is rendered directly on the panel face in the model, on a dedicated tag/layer (observed as `ABF_LABEL` in one workflow). (unverified — single tutorial source)

The label is a **validity gate**, not decoration: only labeled panels flow into breakdown/nesting/export, and (per one power-user's workflow) into the downstream Viyar ordering site. An unlabeled part is a signal, not a formatting gap — it means that part failed a geometry or build-requirement check upstream and never got marked. (unverified)

**Requirement for our app:** treat "unlabeled/untagged" as an explicit validation failure state a user must resolve, not a silently-skipped part. If ZilInventor's own panel-tagging pipeline (see [03-labels-and-reports.md](03-labels-and-reports.md)) has a part that fails to acquire a tag, that should block nesting/export for that part with a visible reason, mirroring ABF's gate.

## Print Labels as the physical shop-floor artifact

Друк Бірок (druk birok — "Print Labels") is the second free mechanism: it prints the physical shop tag that travels with each cut panel. It is thermal-printer-ready (Zebra brand named explicitly) and the template (logo, name, ID) is user-editable. (unverified — single tutorial source; see full label data-model discussion in [03-labels-and-reports.md](03-labels-and-reports.md))

This is the artifact an operator or assembly worker physically holds next to the panel on the shop floor — distinct from the on-model label text described above, which exists only inside the SketchUp scene until this print step externalizes it.

No evidence was found of barcode/QR support in ABF's Print Labels (unlike ZilInventor's own QR-based panel labels, per memory). Only text-field customization (logo, name, ID) is confirmed.

## Exploded View ("Sơ đồ bung" / "Working Drawing"): auto-fan-out, drag-to-space, leader-line anti-overlap

Рознесений вигляд (Ukrainian) / "Sơ Đồ Bung" (Vietnamese, "burst/exploded diagram") is ABF's one free assembly-diagram tool. An English SketchUp-forum thread titled it "Working Drawing in SketchUp ABF plugin," and that phrase is used loosely in this doc set as a synonym — it is not an ABF product name for a distinct feature.

Workflow, as demonstrated in tutorial material: (unverified — inferred from two short informal tutorial clips, no official documentation exists for this tool)

1. Select the group(s) to explode.
2. Invoke the exploded-view tool.
3. Parts auto-fan-out along calculated directions.
4. User drags spacing sliders and rotates the camera to taste.
5. Each part gets an auto leader-line and label callout.
6. Optionally toggle x-ray style or hide the `ABF_LABEL` layer for a cleaner look.

A later update added an anti-overlap algorithm that detects and prevents leader-lines/label text from crossing each other. The vendor frames this explicitly as shop-floor assembly documentation — a Facebook post describes it as preventing visual confusion "cho thợ lắp ráp" (for assembly workers) — not as a design-review or presentation tool. Exact version/date of this update is unknown; only "an update" is referenced.

No UI specifics (slider units, numeric ranges, keyboard modifiers) could be established — there is no vendor documentation page for this tool.

**Requirement for our app:** if ZilInventor's exploded-view/assembly-instruction output targets shop-floor assembly workers (not just design review), leader-line/label collision avoidance is a real, vendor-validated requirement, not gold-plating — ABF shipped it specifically because unresolved overlaps confuse the person building the piece.

## Critical caveat: Exploded View detaches parts and breaks the live parametric link

This is the most important fact in this document. A detailed Ukrainian walkthrough (YARWOOD channel) documents that invoking Exploded View converts the selected parts into a **new, separate Group**, physically detaching them from the live parametric model. The presenter describes this as the tool "breaking" the module. (unverified — single detailed source, but internally consistent with SketchUp's group-copy mechanics and treated as reliable)

Recommended practice, per that same source: run Exploded View only on a duplicated scene or a copy of the model — **never on the production working file**. Once exploded, the resulting geometry is no longer tied back to the parametric source; further edits to the real model will not propagate to the exploded diagram, and edits made to the exploded copy will not propagate back.

The same presenter states he personally does not use ABF's exploded view for real documentation, instead building assembly/working drawings in SketchUp LayOut. This is echoed independently on the official SketchUp forum, where an experienced furniture designer states plainly that true dimensioned working drawings — with hidden-line conventions — are made in SketchUp + LayOut, not via ABF.

**Requirement for our app:** any exploded-view or working-drawing generation in ZilInventor must be non-destructive and non-mutating by construction — it must project/derive a view from the live model without ever converting live parts into a detached copy. This is not a nice-to-have; it is the specific failure mode ABF has and that our own drawing pipeline (already producing dimensioned section/detail views off a live projector, see [05-parity/01-zilinventor-capability-inventory.md](../05-parity/01-zilinventor-capability-inventory.md)) should be confirmed not to share.

## Output via SketchUp's native Export 2D Graphic — no dedicated ABF drawing-export dialog

ABF does not ship its own export dialog for the exploded view. Output goes through SketchUp's built-in **File > Export > 2D Graphic** command. PDF was the only format explicitly demonstrated in source material (Ukrainian tutorial, "зробити експорт 2D графіка вибрати наприклад PDF" — "do a 2D graphic export, choose for example PDF").

SketchUp's native export dialog typically also offers PNG/JPG/EPS, but no ABF-specific tutorial confirmed using those formats for this workflow — treat PDF as the only confirmed path. (unverified for other formats)

There is no evidence of ABF adding dimension annotations, section views, hidden-line treatment, BOM/cut-list tables, or multi-sheet packaging to this exported output. It is a raster/vector snapshot of the SketchUp scene as arranged by hand, not a generated drawing sheet.

## Practitioner note: experienced users bypass this and use SketchUp LayOut instead

Two independent sources — the YARWOOD tutorial presenter and a separate experienced furniture designer on the official SketchUp forum — converge on the same practice: skip ABF's native Exploded View for real documentation and build working drawings in SketchUp LayOut instead, where dimensions and hidden-line conventions are added manually.

A separate, paid, third-party ecosystem fills this gap more directly: "OK Hole Map" and "OK Exploded View," sold on the Ukrainian marketplace sketchup.com.ua as part of an "OK Premium" bundle (199 ₴/month for 6 plugins), are NOT ABF-vendor products. They claim true dimensioned per-part drawings (cutout dimensions + hole maps) and fully automatic model drawings with LayOut/PDF/GLB export — capability ABF itself does not ship. (unverified; vendor relationship between this "OK" suite, ABF Extension, and KosTools is unconfirmed — they appear to be three distinct parties collaborating on one marketplace, not established)

ABF's own roadmap lists a "cutting diagram" feature (dimensions + cut-sequence display) as **paused due to low demand** — i.e. unshipped, and not on an active timeline.

**Confirmed:** no evidence exists of core/free ABF generating dimension annotations, section views, BOM/cut-list tables on a drawing sheet, or multi-sheet drawing packages.

**Implication for ZilInventor's positioning:** ZilInventor's own drawing subsystem (dimensioned views, section/detail views, hole tables, native DXF DIMENSION entities, multi-sheet PDF/SVG/PNG export — see the Sub-project 6 and Drawing F-series feature history) already exceeds what ABF's free tier does, and roughly matches or exceeds what the paid third-party "OK" ecosystem claims. This doc's job is to confirm that gap explicitly rather than assume it: ABF is not a drawings competitor at the free tier, it is a labeling/tagging and shop-tag tool with one crude, non-destructive-unsafe exploded-view add-on. See [05-parity/02-gap-analysis.md](../05-parity/02-gap-analysis.md) for the full side-by-side.

## Source confidence summary

Most claims here come from two informal tutorial videos (33s and 67s, no official captions/documentation), one longer Ukrainian walkthrough (YARWOOD, ~65 min, exploded-view/PDF segment around the 19:00 mark), and one vendor Facebook post caption. None of this is backed by an official ABF manual — no dedicated documentation page for the Exploded View tool was found anywhere. Where a claim rests on a single informal source, it is marked "(unverified)" above rather than stated as flat fact, per this doc set's confidence convention (see [README.md](../README.md#how-to-read-it-reference-vs-requirements-confidence-levels-used-throughout)).
