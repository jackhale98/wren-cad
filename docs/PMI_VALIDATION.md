# PMI validation (M5, STEP AP242)

How Wren's STEP AP242 model dimensions and tolerances (PMI) are checked, and what has been found.
PLAN §12 M5 "Validation" and ADR-100. The automated checks run in CI; the owner's checklist at the
end is done by hand and recorded here.

## What is exchanged

| Wren annotation | AP242 / XCAF | Notes |
| --- | --- | --- |
| Linear, aligned, ordinate dimension | `linearDistance` | Contract v2 (ADR-101): a linear dimension's `direction`, the `at` point qualifiers, and `ordinate` are carried and come back. No direction: points (or any `at`) read back as aligned, faces and edges as linear. STEP has no ordinate type: it is a linear distance that only another Wren reads back as an ordinate. The current kernel build ignores the v2 fields until its v2 support lands. |
| Diameter, radius | `linearDiameter`, `linearRadius` | `spherical` (SR, SØ) is written when the ref is a sphere and read back from the face: Wren draws the S from the sphere. |
| Angle | `angular` | |
| Tolerance: ± and +/− deviations, limits | plus-minus deviation | Limits come back as deviations (noted in the report). |
| Tolerance: ISO 286 fit | limits and fits | STEP holds one class per dimension: H8/f7 writes H8, with a note (kernel). |
| Tolerance: basic, reference | `qualifier` `basic` or `reference`, no tolerance | Carried (ADR-101); no note. |
| Datum feature, also on a feature of size | datum on the faces (of the dimension) | Comes back bound to the dimension (`appliesTo`) when its faces are that dimension's. |
| Feature control frame | geometric tolerance: type, zone, Ø, Ⓜ/Ⓛ, up to three datums with modifiers | SØ zones, zone modifiers, projected and unequal zones and all around are carried (ADR-101). Not exported (skipped with the reason): per-unit zones, common datums (A–B). |
| Chamfer and hole callouts, notes, surface finish | none yet | Skipped with the reason. |
| Presentation | tessellated lines and stroked text from the M4 layout | On the plane of the view that places the annotation in a drawing, else a model view from its faces. Without presentation the annotation ids do not survive (OCCT 8.0.1, ADR-100 amendment). |

Annotations that need attention, are suppressed in the exported configuration, or refer to sketch
or construction geometry (a promoted sketch dimension between sketch points, an origin plane) are
never exported; the summary after the export lists each with its reason.

## Automated checks

| Check | Where | Status |
| --- | --- | --- |
| Every mapping, both directions, and the export → import → export fixpoint | `packages/io/test/pmi.test.ts` | passing |
| Presentation: text stroked where the PDF writer puts it, on the view's plane, model views | `packages/drawing/test/pmi-presentation.test.ts` | passing |
| The M4 bracket: ≥ 15 items (23), each one of its drawing's annotations by id, kind and value; targets are the faces the refs resolve to; presentation from the drawing views; deterministic | `packages/kernel-client/test/regen/pmi.golden.test.ts` | passing (real kernel, simulated façade) |
| Round trip through a real STEP file, the import feature's names and annotations, lossless | same file, "round trip (simulated façade)" | passing |
| Round trip through the real façade (`STEPCAFControl_Writer` / `Reader`) | same file, "Wasm round trip" | runs when the kernel dist has `exportStepPmi`; datum C of the bracket (referenced by no frame) is expected lost (OCCT reads datums only through frames) |
| Kernel façade: counts, types, values, deviations, fits, datums, faces, names, presentation | `packages/kernel/test/pmi.golden.test.ts` (kernel workstream) | CI |
| NIST MBE PMI models are AP242 with semantic and presentation PMI | `packages/io/test/pmi-nist.test.ts` | passing |
| Export option on by default, summary with every reason; import of a NIST model reports its PMI | `apps/web/e2e/m5-pmi.spec.ts` | passing (façade stand-in until the dist has it) |

## NIST MBE PMI test models

Fixtures: `packages/test-fixtures/step/nist/` (CTC 01, 03, 05 and STC 06; licence and hashes in
its README). Entity census (STEP entities, `stepPmiCensus`):

| Model | Dimensions | Tolerances | Datums | Imported annotations | Not read (OCCT) |
| --- | --- | --- | --- | --- | --- |
| CTC 01 (AP242 e1) | 12 | 6 | 3 | 8 dimensions, 6 tolerances, 1 datum (+9 presentation-only) | datums B, C (no geometry), 4 "other" dimensions without a value, 1 modifier; 26 filled presentation areas |
| CTC 03 (AP242 e2) | 10 | 13 | 6 | 9 dimensions, 12 tolerances, 0 datums (+8 presentation-only) | datums A–E (no geometry), F (no readable tolerance), 1 "other" dimension without a value; 34 filled presentation areas |
| CTC 05 (AP242 e1) | 6 | 10 | 4 | 2 dimensions, 9 tolerances, 2 datums (+22 presentation-only) | 4 dimensions and 1 straightness on edges not in the imported body, 2 datum targets, datums C, D |
| STC 06 (AP242 e3) | 17 | 25 | 6 | 17 dimensions, 25 tolerances, 6 datums (+2 presentation-only) | none lost; 2 spherical sizes as plain diameters, 1 spherical zone as cylindrical |

Known OCCT 8.0.1 reader limits (ADR-100 amendment): datums are read only through the tolerances
that reference them; a lower deviation above nominal comes back negated. Recorded 2026-11-20 with
the façade build (kernel-dist of CI #138) through `importShapesWithPmi`.

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
