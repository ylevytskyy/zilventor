# The Solid-Group Input Contract

Every ABF tool — labeling, hardware boring, groove joinery, edge banding, nesting, DXF export — assumes the input model already satisfies one structural contract. If a panel doesn't meet it, ABF either silently ignores the panel or fails to process it. This document states the contract exactly, why it exists, and what our app must do to honor the same contract (or explain to a user why their model doesn't).

## The rule verbatim: one panel = one single-level Solid Group, ABF explodes all Components

ABF's own vendor site (getabf.net) states the rule directly, in the "Các chức năng hiện tại của ABF" (ABF's current functions) section:

> "Mỗi chi tiết tấm là một Solid Group. ABF sẽ explode toàn bộ component chỉ giữ lại trạng thái 1 cấp Group."
> — "Each panel/sheet detail must be a Solid Group. ABF will explode all components, keeping only single-level Group status."

Read literally: every physical panel in the model must resolve to exactly one SketchUp **Group** (not a Component), and that group must be a **true solid** (see below). ABF's own processing step explodes any Components it finds down to a flat, single-level group structure before it can read panels out of the model.

The same page also states the naming/material precondition (covered in more depth further down):

> "Model của Bạn nên được đặt tên & chỉ định mã material đầy đủ."
> — "Your model should be named & assigned a full material code."

**Requirement for ZilInventor:** any model-ingestion or export path that mimics ABF's panel-processing behavior must treat "Group, single level, solid" as the unit of a manufacturable panel — not "any named/tagged geometry" and not "Component instances." If we accept SketchUp-authored models as an interop path, we need an explicit explode/flatten/convert step equivalent to what ABF does internally, or we will silently drop or mis-process Component-based panels the same way ABF does.

## Why Components are invisible to ABF (corroborated across vendor site + tutorial)

This isn't just marketing copy — it's confirmed independently by a hands-on tutorial. In the Ukrainian-language YARWOOD tutorial "ABF - робота з плагіном" (youtube.com/watch?v=uMuSPHSUDf4), the narrator states outright:

> "abf працює тільки з групами, з компонентами він не працює"
> — "ABF works only with groups; it does not work with components at all."

A native SketchUp **Component** — including a Dynamic Component or a plain reusable component brought in from a library — is invisible to ABF's processing until it is converted to a Group. This is corroborated by a second tutorial (youtube.com/watch?v=aaj2kSkRorI), which shows the practical habit this forces on modelers: draw a rectangle, immediately right-click → "Создать группу" (Create Group — SketchUp's native command, not a Component), Push/Pull to thickness, then rename via the Outliner/F2 field (e.g. "Left", "цоколь"/toe-kick, "дно"/bottom, "фасад"/facade). Panels are built as Groups from the very first modeling action, not converted after the fact.

**[confirmed]** ABF works only with Groups and does not process Components at all, independently stated by both the vendor homepage and a tutorial narrator.

**Requirement for ZilInventor:** if we build or accept SketchUp interop, our importer/exporter must key panel identity off Group boundaries, not Component instances. If ZilInventor's own internal model uses something Component-like (instanced/shared geometry) for manufacturable parts, that's a semantic mismatch with ABF's contract worth flagging in the gap analysis (see [05-parity/02-gap-analysis.md](../05-parity/02-gap-analysis.md)).

## Solid-ness requirement: closed manifold volume, self-intersecting/non-solid groups fail silently

A Group alone isn't enough — it must also be a true SketchUp **Solid**: a closed manifold volume, the kind SketchUp itself flags with its solid-inspector icon. The tutorial narrator gives this as the diagnostic when ABF doesn't detect or label a shape correctly: the shape is either (a) actually a Component (see above), or (b) a Group that is not solid — self-intersecting or otherwise non-manifold geometry.

This matches an independent report from a SketchUp forum user (selfsufficient, forums.sketchup.com/t/abf-furniture-cnc/127578/9), who found that ABF "doesnt export groups that have details like cutouts for back panels to slide in… only export[s] completely flat surfaces." In other words, ABF's export path expects simple, flat, solid rectangular volumes — not panels with cut-in notch geometry baked into the solid.

**[confirmed]** ABF requires each panel Group to be a true solid (closed manifold); non-solid or self-intersecting groups are not reliably processed, and groups containing cutout geometry export only as flat surfaces or fail to export panel detail at all (per an independently reporting forum user, not the vendor).

There is a second, indirect solid/geometry-validity check built into ABF's workflow: the auto-label placement step. The tutorial narrator notes a face-symmetry precondition for a label to attach:

> "вона повинна бути однакова що з однієї сторони що з іншої"
> — "[the panel face] must be identical on one side as on the other."

If ABF's label fails to place on a panel, that is used diagnostically as a sign the panel geometry is deformed or asymmetric — label placement doubles as an implicit geometry-validity check, not just a cosmetic step.

**Requirement for ZilInventor:** any panel-manufacturability check we run (for nesting, DXF export, or labeling) should validate closed/manifold solid geometry up front and report the failure explicitly, rather than mimicking ABF's silent-failure behavior. See also the groove/cutout limitation below — solid-ness failures caused by hand-cut notch geometry have a specific fix.

## Naming and material-code convention required before running tools

Beyond "Group + solid," ABF's own homepage names a second precondition: the model should be named and assigned a full material code before running ABF's tools. This is not decorative — material identity and thickness drive downstream grouping.

Key facts about how ABF actually reads these values (from the Ukrainian tutorial, not independently documented by the vendor in writing):

| Attribute | Source | Behavior |
|---|---|---|
| Panel thickness | A field the tutorial calls "шар" (layer) in ABF's panel-properties view — ambiguous whether this is SketchUp's native Tag or an ABF-internal field | Displayed per panel (e.g. "18 мм"); changing thickness and re-running the parts breakdown splits the panel into a new group |
| Material identity | The SketchUp material assigned to the panel, plus a decor/texture code baked into the material's name (example: "u702") | Carries the material through to production/BOM; changing material also splits the panel out on re-breakdown |
| Grain/texture direction | A separate "технічна текстура" (technical texture) attribute tied to the panel's auto-placed label, not the material's UV/texture mapping | Set by rotating the *label* (a distinct action from rotating/flipping the visible material) |

The narrator is explicit that visual and technical texture are not the same thing: "обертання міток відповідає за її текстуру… візуальна текстура не відповідає за це, відповідає за це тільки технічна текстура" — "rotating labels controls its texture… the visual texture does not matter, only the technical texture matters."

Naming itself is supported by a dedicated "Перейменувати" (Rename) tool that operates on material names, group/component names, and per-part names, with batch rename, prefix-adding, presets, and the ability to strip auto-generated sequence numbers that ABF's own labeling stage appends.

**[confirmed]** Material identity for grouping/nesting is driven by the assigned SketchUp material plus an embedded decor/texture code in the material name; changing material or thickness and re-running the breakdown auto-splits panels into distinct groups by the new value.

**Note (unverified specifics):** exactly how thickness ties to a "шар"/layer field — whether it's literally SketchUp's native Tag system or an ABF-internal per-group attribute — was not confirmed beyond the tutorial narrator's usage. Treat "шар" as ABF's own field, not necessarily a SketchUp Tag, until independently verified.

**Requirement for ZilInventor:** our own material/thickness model already carries these as first-class panel properties (see [05-parity/01-zilinventor-capability-inventory.md](../05-parity/01-zilinventor-capability-inventory.md)), so this maps cleanly — but grain/texture direction as a *separate* attribute from visual material orientation is a distinct requirement worth checking against our current material-texture handling.

## Known limitation: groups with cut-in geometry (e.g. back-panel slide notches) fail export — modeled cuts belong in ABF's groove tool, not hand-cut notches

This is the practical consequence of the solid/flat-panel requirement above, worth calling out as its own limitation because it's a common real-world modeling mistake. If a panel is modeled with a hand-cut notch or cutout baked directly into its solid geometry — for example, a slot cut into a back panel so it can slide into a groove — ABF's export does not reliably handle it. The independently reporting forum user found ABF "only export[s] completely flat surfaces" and drops groups with that kind of cut-in detail.

The correct ABF-native workflow is: model the panel as a plain flat solid rectangle, then apply ABF's own **groove tool** (paz) on top of it as a nested child feature (see [03-machining/02-hardware-boring-and-joinery.md](../03-machining/02-hardware-boring-and-joinery.md)) — not hand-model the cut into the panel body. Grooves in ABF are stored as their own nested child Group inside the panel group, carrying width/depth/edge-offset attributes, distinct from the panel's own solid.

**[confirmed, from an independent third-party report, not the vendor]** ABF's export drops or flattens groups containing hand-modeled cutout/notch geometry; this is a forum user's field report (forums.sketchup.com/t/abf-furniture-cnc/127578/9, /11), not a documented vendor limitation.

**Requirement for ZilInventor:** if we replicate this workflow, our groove/dado feature (see the existing groove-cut milestone) must be positioned as the canonical way to express such cuts, and our modeling guidance/validation should flag hand-cut notch geometry on a panel as non-manufacturable input, consistent with ABF's own behavior.

## Convert Component to Group tool as the escape hatch for imported/library geometry

Because real-world modeling — imported furniture libraries, copied fixtures, dynamic components — frequently produces Components rather than Groups, ABF ships a dedicated conversion tool: "Convert Component to Group" (Vietnamese: "Chuyển đổi component sang Group"). This is confirmed by the vendor's own demo video (facebook.com/abfurnituresolutions/videos/abf-plugin-convert-component-to-group-sketchup/631685767423375/) and shown live inside the "Перейменувати"/Rename panel in the Ukrainian tutorial.

Two properties matter for correctness:

1. **Hierarchy is preserved, not flattened.** Converting a Component to a Group keeps parent/child structure intact — a top-level module can remain a group with panel sub-groups nested inside it: "може бути головний ваш компонент далі можуть бути наші підгрупи… перетворюючи компонент в групу… наш модуль буде згрупований, він не розіб'ється при розмітці" — "there can be a top-level component, then sub-groups; after conversion the module stays grouped and won't fall apart when labeling." This reconciles the "1-level Group" wording on getabf.net with real assemblies: it's each *panel* that must resolve to one Group, not the whole model that must be flat.
2. **A sibling "Face to Group" tool** exists for the opposite direction — turning a bare face/plane into its own independent group, used when a stretched/edited face needs to become its own panel rather than recreating a group by hand.

A related QA tool, "Параметр компонентів" (component-count), lets a user select a converted group and see how many panels are nested inside — used as a post-conversion sanity check.

**[confirmed]** ABF ships a dedicated Component→Group conversion tool that preserves parent/child grouping hierarchy, plus a separate Face→Group converter; both are demonstrated in vendor/tutorial material, not just claimed in marketing copy.

**Requirement for ZilInventor:** if we accept SketchUp files (or any format with an instanced/Component-like construct) as input, we need an equivalent explicit "flatten to solid group" conversion step in our own import pipeline — one that preserves assembly hierarchy the way ABF's tool does — rather than silently dropping Component-based geometry the way ABF does when the user skips this step.

## Summary: the contract in one table

| Requirement | Detail | Failure mode if violated |
|---|---|---|
| Group, not Component | Native SketchUp Group, single level per panel | Panel invisible to ABF entirely |
| True solid | Closed manifold volume, no self-intersection | Silent non-detection; label placement fails |
| No hand-cut notches | Cuts must be groove-tool features, not modeled-in geometry | Export drops the panel or exports only a flat surface |
| Named | Panel/group has an explicit name | Downstream labeling/BOM/reporting can't identify the part |
| Material assigned + coded | SketchUp material with embedded decor/texture code (e.g. "u702") | Panel can't be grouped/nested correctly by material; BOM material tracking breaks |
| Thickness resolvable | Read from ABF's panel-properties field (source unconfirmed — possibly a Tag) | Panel can't be grouped/nested correctly by thickness |

Related reading: [02-panel-modeling-practice.md](02-panel-modeling-practice.md) for the concrete step-by-step modeling sequence that satisfies this contract, [03-machining/02-hardware-boring-and-joinery.md](../03-machining/02-hardware-boring-and-joinery.md) for how grooves/hardware nest inside a compliant panel group, and [05-parity/03-processing-parity-requirements.md](../05-parity/03-processing-parity-requirements.md) for how this contract translates into testable requirements for ZilInventor.
