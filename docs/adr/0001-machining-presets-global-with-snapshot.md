# 0001 — Machining presets are app-global; applying one snapshots values into the document

Status: accepted (D1–D9 user-confirmed 2026-07-02; implemented by P3 — see docs/superpowers/plans/2026-07-02-p3-machining-presets-cam-metadata.md).

Presets describe the user's machine/shop, not the model, so they live app-global (like ABF's plugin settings) and survive across documents. Applying a preset copies its values onto the bore/groove; editing a preset later never changes existing documents — production files must not drift after the fact. Rejected: per-document presets (re-entry per file, worse than ABF), live-linked presets (silent retroactive changes to old jobs' DXF).
