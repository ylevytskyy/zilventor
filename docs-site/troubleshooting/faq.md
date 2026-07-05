---
title: FAQ
---
# FAQ
> Quick answers to the questions that come up most often.

### Where's the Save button?

The **Save** button in the File tab is present but permanently disabled —
Zilventor autosaves continuously to OPFS as you work, so there's no manual
save step. Use **Save As** if you want to write a copy to a specific
location on disk. See [Saving and Sessions](../concepts/saving-and-sessions.md).

### Why did my file reopen automatically when I loaded the app?

Zilventor remembers the last document you had open and restores it
automatically on the next load, once the kernel is ready. This is session
restore, not a bug — if you want a clean start instead, open or create a
different document from the File tab. See
[Saving and Sessions](../concepts/saving-and-sessions.md).

### Why is a button grayed out?

Most ribbon actions require context before they're enabled — commonly an
open assembly (many Furniture-tab actions need a cabinet/assembly active,
not just a part) or a selection in the viewport/tree. Hover the button; a
tooltip usually names the missing prerequisite (e.g. "Open or create an
assembly first").

### Can I open a file saved by a newer version of the app?

No — Zilventor checks the file's format version on open and refuses to load
anything newer than the current build supports, rather than risk silently
misreading it. You'll get an explicit error naming both the file's format
version and the version your build supports. Update the app, or reopen the
file in the version (or newer) it was saved with.

### How do I fit the model to the view?

There currently isn't a working shortcut or button for this — the View
tab's **Fit** and **Home** buttons are dead in this build (see
[Known Limitations](./known-limitations.md)), and the automatic fit only
runs once, when a file is opened. Use the mouse (scroll to zoom, drag to
orbit/pan) to reframe manually, or reopen the file to trigger the
one-time automatic fit again.

### Why are some ribbon labels in Ukrainian even though my UI is set to English?

A couple of Присадка ribbon labels on the Furniture tab have Ukrainian text
recorded in the English locale file — an i18n data bug, not a language
setting issue. The buttons themselves work correctly regardless of the
label text. See [Known Limitations](./known-limitations.md).

## See also

- [Known Limitations](./known-limitations.md)
- [Browser Issues](./browser-issues.md)
- [Saving and Sessions](../concepts/saving-and-sessions.md)
