# ABF Plugin Documentation — Index

This doc set describes ABF, a free SketchUp extension for CNC panel-furniture
production, and maps it against ZilInventor's own manufacturing-processing
capabilities. It exists to turn a competitor product into a concrete,
testable requirements list — not to sell or criticize ABF.

## Why this doc set exists (ABF as requirements source for ZilInventor parity)

ZilInventor is building toward the same end goal ABF already ships: let a
designer drive CNC-based panel-furniture production directly from a 3D model,
without depending on a skilled carpenter to interpret drawings by hand. ABF
is a live, free, widely-used tool that already solves large parts of this
problem for the SketchUp ecosystem. Rather than re-deriving furniture-CAD
manufacturing requirements from first principles, this doc set treats ABF's
demonstrated behavior as a requirements source: what it asks the modeler to
do, what machining metadata it captures, what files it hands off to CNC and
the shop floor, and where it is deliberately incomplete or paused.

The end product of this doc set is [05-parity/03-processing-parity-requirements.md](05-parity/03-processing-parity-requirements.md)
— a concrete list of what ZilInventor must do to match ABF's demonstrated
production capability. Everything before that section is the evidence base
for that list.

This is not a general ABF user manual. It only documents behavior relevant
to the manufacturing-processing pipeline (model contract → machining →
nesting → export → shop floor), because that is the part of ABF that maps
onto ZilInventor's scope.

## How to read it (reference vs requirements, confidence levels used throughout)

The doc set has two modes, and each file is one or the other:

- **Reference docs** (`01-overview/`, `02-model-setup/`, `03-machining/`,
  `04-production-output/`) describe what ABF *does*, as observed. They are
  descriptive, not prescriptive.
- **Parity docs** (`05-parity/`) translate that description into what
  ZilInventor *must do* — a gap analysis and a requirements list. These are
  prescriptive and are the actionable output of the set.

Every claim in the reference docs carries an implicit or explicit confidence
level, because the source material is a mix of primary (live vendor site),
secondary (tutorial videos, forum posts), and audited (this codebase) origin.
Three tags are used consistently:

- **Unmarked** — corroborated by a primary source (live getabf.net content,
  or direct codebase inspection). Treat as fact.
- **(unverified)** — plausible, sourced from a single secondary source (a
  tutorial video, a content-marketing article) with no primary corroboration.
  Do not build a hard requirement on an (unverified) claim without checking
  it against the live product or asking the user first.
- **Refuted / corrected** — a claim that was checked and found wrong. These
  are never presented as fact; the doc states the correction directly instead
  of the original claim.

If a document doesn't say otherwise, assume its claims are corroborated.
Where confidence matters for a specific fact, the surrounding doc says so
inline rather than relying on a global disclaimer.

## Folder map with one-line description per file, in reading order

| # | File | What it covers |
|---|------|-----------------|
| 1 | [01-overview/01-what-is-abf.md](01-overview/01-what-is-abf.md) | ABF's origin, maker, business model, platform requirements, and stated mission. |
| 2 | [01-overview/02-video-walkthrough-summary.md](01-overview/02-video-walkthrough-summary.md) | A primary tutorial video's end-to-end workflow, summarized in sequence. |
| 3 | [01-overview/03-end-to-end-workflow.md](01-overview/03-end-to-end-workflow.md) | The single-page mental model of the full ABF pipeline, stage by stage. |
| 4 | [02-model-setup/01-solid-group-contract.md](02-model-setup/01-solid-group-contract.md) | The mandatory Solid-Group input contract every ABF tool assumes. |
| 5 | [02-model-setup/02-panel-modeling-practice.md](02-model-setup/02-panel-modeling-practice.md) | The concrete modeling sequence that produces ABF-compliant panels. |
| 6 | [03-machining/01-machining-primitives.md](03-machining/01-machining-primitives.md) | The three geometric primitives (points, paths, intersections) ABF uses to describe machining. |
| 7 | [03-machining/02-hardware-boring-and-joinery.md](03-machining/02-hardware-boring-and-joinery.md) | Every hardware type ABF bores for, and how groove-based joinery is expressed. |
| 8 | [04-production-output/01-nesting.md](04-production-output/01-nesting.md) | ABF's two nesting-adjacent features (Quick-Nesting vs. the paused cutting-diagram tool) and their maturity. |
| 9 | [04-production-output/02-cnc-dxf-export.md](04-production-output/02-cnc-dxf-export.md) | Exactly what ABF's DXF export contains and how it's organized. |
| 10 | [04-production-output/03-labels-and-reports.md](04-production-output/03-labels-and-reports.md) | The panel-label data model and shop-floor artifacts (printed labels, BOM/Statistics). |
| 11 | [04-production-output/04-drawings-and-exploded-views.md](04-production-output/04-drawings-and-exploded-views.md) | ABF's thin native drawing capability and its model-mutation caveat. |
| 12 | [05-parity/01-zilinventor-capability-inventory.md](05-parity/01-zilinventor-capability-inventory.md) | Snapshot of what ZilInventor's codebase already does today, as the gap-analysis baseline. |
| 13 | [05-parity/02-gap-analysis.md](05-parity/02-gap-analysis.md) | Side-by-side comparison, aspect by aspect: what ABF does that ZilInventor doesn't (and vice versa). |
| 14 | [05-parity/03-processing-parity-requirements.md](05-parity/03-processing-parity-requirements.md) | The concrete, testable requirements list distilled from the gap analysis. |

Read `01` through `04` in order first — each builds vocabulary the next
section assumes (e.g. "Solid Group" and "machining face" from `02` are used
without re-explanation in `03` and `04`). `05` can be read on its own once
you know ZilInventor's codebase, but it references terminology from `01-04`
throughout.

## Source provenance note (vendor site, forum, YouTube tutorials, ZilInventor codebase audit — confidence caveats)

Material for `01-overview/` through `04-production-output/` comes from three
kinds of source, in descending order of reliability used in this set:

1. **Live vendor site** (getabf.net) — a JavaScript single-page app. Content
   was captured via a JS-rendered browser fetch, not a plain HTML fetch;
   plain HTML fetches of this site silently miss entire feature sections
   (verified during research — a static fetch reported several real features
   as "not found"). Where a claim cites getabf.net, assume it was captured
   this way unless the doc says otherwise.
2. **YouTube tutorials and the SketchUp/ABF community forum** — used for
   workflow sequencing and terminology the marketing site doesn't spell out
   (e.g. exact click order, dialog names). These are secondary sources:
   useful for what a real user sees, but not authoritative for what's
   currently shipping vs. planned. Claims sourced this way that lack site
   corroboration are tagged `(unverified)`.
3. **ZilInventor codebase audit** — used only in `05-parity/01-zilinventor-capability-inventory.md`
   and the docs that build on it. This is a direct source-and-git-history
   read of local `master`, not a memory or changelog summary, so it is
   treated as reliable for "does this capability exist" — but it is a
   point-in-time snapshot (local `master`, unpushed) and does not verify
   runtime behavior (no app execution or test run was performed as part of
   this audit).

Known gaps in the source material, carried over into the affected docs rather
than papered over: no primary-source comparison of ABF against named
competitor CAD/CAM tools exists; ABF's version/changelog history could not be
established; the in-development PRO nesting tier's scope and pricing are
unconfirmed beyond its existence. Where a downstream doc depends on one of
these gaps, it says so rather than guessing.
