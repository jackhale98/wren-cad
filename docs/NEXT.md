# Next steps (handoff, 2026-11-20)

Where work stopped and the proposed order when it resumes. Items marked **owner** need a decision.
Live: main `ff5fc3e` on wren-cad.app (datum fixes, STEP AP242 export with PMI).

## Proposed order

1. **NIST import fixes** (kernel + `@wren-cad/io`; results in `PMI_VALIDATION.md`):
   - One summary line for filled presentation areas (60 of 86 report entries) and draw the fills.
   - Datums "attached to no geometry" (CTC 01 B, C; CTC 03 A–E): follow the datum feature's
     shape aspect to its faces when OCCT gives no ref shape.
   - "Edge not part of the imported bodies" (CTC 05, 5 items): likely our TopExp index mapping
     after import healing. Probably a bug.
   - "Other dimension has no value" (CTC 01 ×4, CTC 03 ×1): identify the type, read it.
   - Golden per NIST model: imported counts as regression tests. Probe script used to measure:
     import each `test-fixtures/step/nist/*.stp.gz` with `importShapesWithPmi` on the real dist.
   - Later (contract changes): datum targets, frame modifiers, spherical size/zone.
2. **Sketch-dimension PMI export:** map a sketch entity to its swept face by persistent name
   (`F<feat>:side(S..e(..))`); bracket golden goes from 23 to all import-planned annotations.
3. **Save as project folder:** a "Save as project folder" option next to the `.wrencad`
   download, and a prompt when a `.wrencad` is saved inside a git repo (owner saved a zip into git
   and could not diff it). Today: Connections → Folder on this device → New project folder here.
4. **Phone (owner to confirm):** an opt-in "Use full editor" on phones (the desktop shell at
   touch density, as tablets), then light edits in the phone shell: feature values inline,
   configuration switch, save/compare/release versions, drawing redline/comments.
5. **M6 assemblies before M5b** (owner to confirm; record as an ADR and reorder PLAN §12): M6
   does not depend on M5b; assembly STEP needs only per-part PMI export, which is live.
6. **M5b** MBD in 3D: annotation planes, model views, viewport rendering and picking.
7. **M7** hardening, then the simulation track.

## Owner checks pending

- PMI validation with the NIST STEP File Analyzer and one third-party CAD tool
  (`PMI_VALIDATION.md` owner checklist).
- 3D mouse tilt left/right after the reverse switches.

## Small backlog

Tablet command bar clips at 744 px with a panel open; unused ToolRail; 6 desktop m4-toolbar
baselines; long-press timing from event timestamps (task 35); contract follow-ups (task 37);
drag perf probe on a quiet machine; datum triangle overlaps the outside arrowhead on linear
dimensions.
