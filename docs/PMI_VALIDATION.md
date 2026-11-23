# PMI validation (M5, STEP AP242)

How Wren's STEP AP242 model dimensions and tolerances (PMI) are checked, and what has been found.
PLAN §12 M5 "Validation" and ADR-100. The automated checks run in CI; the owner's checklist at the
end is done by hand and recorded here.

## What is exchanged

| Wren annotation | AP242 / XCAF | Notes |
| --- | --- | --- |
| Linear, aligned, ordinate dimension | `linearDistance` | Contract v2 (ADR-101). The measuring `direction` is the CAx-IF `orientation` placement of the linear distance (OCCT 8.0.1 writes and reads it only for its own unnamed form; the kernel adds and reads it in the STEP model). The `at` points and the ordinate form are Wren descriptions (STEP has neither): another system reads a linear distance between the faces; the export notes it. |
| Diameter, radius, SØ, SR | `linearDiameter`, `linearRadius` (`spherical`: spherical diameter, radius) | |
| Basic, reference dimension | dimensional note `theoretical`, `auxiliary` (CAx-IF) | Written without a tolerance (a tolerance given with it is noted and not written). |
| Angle | `angular` | |
| Tolerance: ± and +/− deviations, limits | plus-minus deviation | Limits come back as deviations (noted in the report). |
| Tolerance: ISO 286 fit | limits and fits | STEP holds one class per dimension: H8/f7 writes H8, with a note (kernel). |
| Datum feature, also on a feature of size | datum on the faces (of the dimension) | Comes back bound to the dimension (`appliesTo`) when its faces are that dimension's. |
| Feature control frame | geometric tolerance: type, zone, Ø, SØ, Ⓜ/Ⓛ, up to three datums with modifiers; zone modifiers (free state, tangent plane, statistical, CZ); projected zone (`projected_zone_definition`); all around (`all_around_shape_aspect`) | SZ is written as AP242's separate requirement, the closest modifier (noted; read back approximated). Unequal zones: OCCT 8.0.1 cannot write them, written without, noted. Not exchanged: per-unit zones, common datums (A–B). |
| Chamfer and hole callouts, notes, surface finish | none yet | Skipped with the reason. |
| Presentation | tessellated lines and stroked text from the M4 layout; filled areas (`triangles`) as `complex_triangulated_surface_set` | On the plane of the view that places the annotation in a drawing, else a model view from its faces. Without presentation the annotation ids do not survive (OCCT 8.0.1, ADR-100 amendment). Filled areas of other systems (arrowheads, filled text) are imported as triangles. |

Annotations that need attention, are suppressed in the exported configuration, or refer to sketch
or construction geometry (a promoted sketch dimension between sketch points, an origin plane) are
never exported; the summary after the export lists each with its reason.

## Automated checks

| Check | Where | Status |
| --- | --- | --- |
| Every mapping, both directions, and the export → import → export fixpoint | `packages/io/test/pmi.test.ts` | passing |
| Presentation: text stroked where the PDF writer puts it, on the view's plane, model views | `packages/drawing/test/pmi-presentation.test.ts` | passing |
| The M4 bracket: ≥ 15 items (28), each one of its drawing's annotations by id, kind and value; targets are the faces the refs resolve to; presentation from the drawing views; deterministic | `packages/kernel-client/test/regen/pmi.golden.test.ts` | passing (real kernel, simulated façade) |
| Round trip through a real STEP file, the import feature's names and annotations, lossless | same file, "round trip (simulated façade)" | passing |
| Round trip through the real façade (`STEPCAFControl_Writer` / `Reader`) | same file, "Wasm round trip" | runs when the kernel dist has `exportStepPmi`; since phase 1b the kernel reads datums no frame references from the STEP model, so datum C of the bracket comes back too |
| Kernel façade: counts, types, values, deviations, fits, datums, faces, names, presentation | `packages/kernel/test/pmi.golden.test.ts` (kernel workstream) | CI |
| Kernel façade, contract v2: each field written and read back, or noted | `packages/kernel/test/pmi-v2.golden.test.ts` | CI |
| Kernel façade, NIST models: counts, issue codes and severities, every recovered item | `packages/kernel/test/pmi-nist.golden.test.ts` | CI |
| NIST MBE PMI models are AP242 with semantic and presentation PMI | `packages/io/test/pmi-nist.test.ts` | passing |
| Export option on by default, summary with every reason; import of a NIST model reports its PMI | `apps/web/e2e/m5-pmi.spec.ts` | passing (façade stand-in until the dist has it) |

## NIST MBE PMI test models

Fixtures: `packages/test-fixtures/step/nist/` (CTC 01, 03, 05 and STC 06; licence and hashes in
its README). Entity census (STEP entities, `stepPmiCensus`):

| Model | Dimensions | Tolerances | Datums | Imported annotations (2026-11-23) | Lost | Approximated, cosmetic |
| --- | --- | --- | --- | --- | --- | --- |
| CTC 01 (AP242 e1) | 12 | 6 | 3 | 8 dimensions, 6 tolerances, 3 datums (+9 presentation-only) | 4 dimensions the file gives no value (`noValue`) | none |
| CTC 03 (AP242 e2) | 10 | 13 | 6 | 9 dimensions, 13 tolerances, 6 datums (+8 presentation-only) | 1 dimension the file gives no value (`noValue`) | the per-unit-area flatness without its per-unit refinement (`unsupportedEntity`) |
| CTC 05 (AP242 e1) | 6 | 10 | 4 | 2 dimensions, 9 tolerances, 2 datums (+22 presentation-only) | 4 dimensions and 1 straightness on supplemental lines beside the solid (`supplementalGeometry`); datums C, D defined only by datum targets (`datumTarget`) | a statistical dimension modifier (`dimensionModifier`) |
| STC 06 (AP242 e3) | 17 | 25 | 6 | 17 dimensions, 25 tolerances, 6 datums (+2 presentation-only) | none | a controlled radius modifier (`dimensionModifier`) |

Lost before and after (ADR-101 phase 1b; counts are the census, dimensions + tolerances + datums):
CTC 01 6 of 21 → 4; CTC 03 8 of 29 → 1; CTC 05 7 of 20 → 7; STC 06 0 of 48 → 0. The 26 and 34
"filled presentation areas are not imported" entries of CTC 01 and 03 are gone (the triangles
come in). Recorded with the phase 1b façade build through `importFile` (kernel golden
`packages/kernel/test/pmi-nist.golden.test.ts`).

What is still lost, and why:

- **No value in the file** (CTC 01 ×4, CTC 03 ×1): `dimensional_location` / `dimensional_size`
  entities with geometry and a presentation but no `dimensional_characteristic_representation`.
  There is nothing to read; the report names each with its type.
- **Supplemental geometry** (CTC 05 ×5): the dimensions and the straightness apply to trimmed lines
  of a `geometric_curve_set` in the part's shape representation, beside the solid (no shared
  vertex or edge). The import returns solids only, so they have no target; Wren never moves them
  onto a nearby edge.
- **Datum targets** (CTC 05 C, D): the datums are defined only by rectangular datum targets, which
  need their own annotation kind (not in contract v2). Frames referencing C and D keep the letters.

Known OCCT 8.0.1 reader limits and how the import works around them (ADR-100 amendments): datums
are read only through tolerances and only from a `geometric_item_specific_usage` of the datum
feature (the STEP model is read for the rest: other usages, the presentation the symbol is
attached to, datums no tolerance references); a typed `SET_REPRESENTATION_ITEM(...)` list is
parsed as a null item (read from the file text); `draughting_callout_relationship` is not
modelled; the `orientation` of a linear distance is ignored; complex GD&T entities with a part it
has no class for are skipped silently (now reported, tolerances without datums read); a lower
deviation above nominal comes back negated.

## Owner checklist

Export the bracket (the M4 drawing, with its datums and frames) as STEP AP242 with PMI and
presentation, then:

- [ ] **NIST STEP File Analyzer and Viewer** (<https://www.nist.gov/services-resources/software/step-file-analyzer-and-viewer>):
  open the file with "Semantic PMI" and "Graphic PMI" reports and the syntax checker on.
  - [ ] No structural errors in the PMI entities (PLAN M5 accept).
  - [ ] The semantic PMI report lists every exported dimension and tolerance with its value,
    tolerance or fit, datum frame and the faces it is on.
  - [ ] The graphic PMI shows each annotation as in the drawing, on the right plane.
  - [ ] Record the analyzer's version, warnings and the counts here.
- [ ] **Third-party CAD** (at least one: FreeCAD 1.x with its STEP PMI import, or a commercial
  system the owner has):
  - [ ] The part opens with the right geometry.
  - [ ] The PMI shows (presentation at least; semantic where the system reads it).
  - [ ] Record the system, version and what showed or did not.
- [ ] **Round trip in Wren:** import the exported file into a new document. Every annotation comes
  back with the same id, kind, value and tolerance, nothing needs attention, and the report lists
  nothing unexpected.
- [ ] **NIST models in Wren:** import CTC 01, 03, 05 and STC 06; fill in the table above from the
  import report.

## Results

None recorded yet.
