---
title: Documents and Kinds
---
# Documents and Kinds

> Every document you open in Zilventor is one of three kinds — Part, Assembly, or Drawing —
> and the kind decides which ribbon tabs and tools are available.

A document's kind is stored right in its file: a `kind` field on the manifest (`part`,
`assembly`, or `drawing`). Older files saved before this field existed are treated as parts
when they're opened. The kind isn't just metadata — it changes what you can do with the
document. A part gives you modeling tools (sketches, extrudes, features). An assembly swaps
the modeling tab for component-placement and constraint tools. A drawing strips modeling away
entirely and gives you only projection and annotation tools.

## Part (`.zipt`)

A part is a single solid — one panel, one bracket, one machined piece. Its document stores:

- `parameters` — named values the feature tree can reference
- `featureTree` — the ordered list of sketches, extrudes, and other features that build the
  solid
- `materials` — the part's own material list (not shared with other documents)
- `hardware`, optional `bores`, `color`, and `configurations` (iPart-style variants)

Create a part when you're modeling one physical piece of material — a cabinet side panel, a
drawer front, a custom bracket — independent of how it fits into a larger assembly.

## Assembly (`.ziasm`)

An assembly is a collection of parts and sub-assemblies placed together, positioned, and
constrained relative to each other — a whole cabinet, a drawer bank, a full piece of
furniture. Its document stores:

- `components` — the list of parts/sub-assemblies placed into it (see below)
- `constraints` and `groundedComponentPaths` — how components are positioned relative to each
  other and to the world
- its own `materials` array — like parts, each assembly carries its own material list rather
  than pulling from one shared registry
- `colors`, `bomItemNumbers`, `cutListItemNumbers` — bill-of-materials and cut-list bookkeeping

Create an assembly when you're placing multiple parts together to build something — this is
where cabinets get put together, hardware gets attached, and BOM/cut-list data lives.

## Drawing (`.zidw`)

A drawing is a 2D technical-drawing sheet: views projected from a part or assembly's 3D
geometry, plus dimensions, annotations, and tables laid over them. A drawing doesn't hold
modeling data of its own — it references a source part or assembly and derives its views from
that source's geometry. Create a drawing when you need shop documentation — dimensioned
views, section/detail views, hole tables — for something you've already modeled.

## How the ribbon changes per kind

The ribbon's tab set depends on which kind of document is active
(`packages/app/src/shell/Ribbon.tsx`):

| Kind | Tabs shown |
|---|---|
| Part | File, Model, Sketch, Furniture, Inspect, Drawing, View |
| Assembly | File, **Assembly**, Sketch, Furniture, Inspect, Drawing, View |
| Drawing | File, Drawing, View |

Opening an assembly swaps the **Model** tab (sketch/feature modeling) for an **Assembly** tab
(component placement and constraints) — but the **Sketch** tab stays available on both parts
and assemblies. Drawings cut the tab set down to just **File**, **Drawing**, and **View**:
there's no modeling or assembly tooling at all, since a drawing only projects and annotates
geometry that already exists elsewhere.

![Ribbon tab set for a part document, showing the Model tab and its Create/Work Features/Modify/Pattern/Parameters groups](/img/concepts/ribbon-part.png)

## How assemblies reference parts and sub-assemblies

An assembly doesn't embed the parts it uses — it references them by file path. Each entry in
an assembly's `components` list is a **component instance**: an `id`, a `partPath` pointing at
an OPFS file, a `position` and `rotation`, visibility, and optional extras like `color`,
`role`, `doorSpec`, or `drawerSpec`. Components can also carry an additional `pose` on top of
`position`/`rotation`, which — when present — wins over the plain rotation values.

Whether a component is a leaf part or a nested sub-assembly depends entirely on what its
`partPath` points at:

- if it ends in `.zipt`, it's a leaf part
- if it ends in `.ziasm`, it's a nested sub-assembly — which can itself contain further
  component instances, pointing at more parts or more sub-assemblies

There's no depth limit enforced — assemblies can nest inside assemblies as deep as the design
calls for, and the app walks that structure recursively wherever it needs to see everything in
the tree (for example, merging BOM and cut-list data up from every nested level).

## See also

- [Interface Tour](../getting-started/interface-tour.md)
- [The Browser Tree](./the-browser-tree.md)
- [Placing Components](../assemblies/placing-components.md)
- [Panels](../furniture/panels.md)
