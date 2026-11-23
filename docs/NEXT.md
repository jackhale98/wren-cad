# State and order of work (owner approved 2026-11-23; ADR-101, ADR-102)

The order of work after M5a, the architecture rules it follows, and how agents are used.
Live: main `7bc8e3d` on wren-cad.app (Phase 1 included). Work happens on a `claude/**` session
branch and reaches main by merge; there is no `dev` branch.
This file is the single state file: update it at every merge; a new session starts by reading it.

## 0. Status

- Phase 0: done. Open: read the first real nightly Soak result (the fix `8889ecc` is on main;
  nine releases went out with no soak, so expect findings). CI runs
  `scripts/check-workflow-permissions.mjs` (a caller that does not grant what a reusable workflow
  asks for); `actionlint` was not added and is in the backlog (§6).
- Phase 1: done, on main and live (`7bc8e3d`). Results: NIST imports lose 12 annotations across
  the four models (was 21; see `PMI_VALIDATION.md`); the bracket exports 28 (was 23); the Wasm
  round trip loses nothing.
- Phase 1 leftovers, each with a home in §3: the proposed contract additions (a `PmiIssueCode`
  union, `perUnit` on PMI tolerance items, `modifiers` on PMI dimensions,
  `ModelingApi.sketchGenerated`) and the datum-target annotation kind go into the 6.0 contract
  revision; datum-target import and its drawing symbol are built in Phase 4 (CTC 05 datums C, D).
  At the M5 gate, review the kernel's reading of raw STEP text for recovered datums and its use
  of an OCCT-internal reader (ADR-100 amendment).
- Now: Phase 2.

## 1. Owner decisions (all approved 2026-11-23)

1. Assemblies (M6) before MBD in 3D (M5b). Recommended: yes.
2. Phone: an opt-in full editor, then light edits in the phone layout. Recommended: yes.
3. Agent tiers as in §5 (model and effort set per agent file). Recommended: yes.
4. Assemblies ship in slices behind a "Preview: assemblies" setting until mates work. Recommended: yes.

## 2. Shared building blocks (why the order is what it is)

Each is built once, early, and reused by later phases.

| Block | Built in | Reused by |
| --- | --- | --- |
| **PMI contract v2** (additive): dimension `direction`, per-target `at`, `qualifier`, zone modifiers, spherical size and zone, issue `code` and `severity`. Not in v2: datum targets (6.0), `importedPmi` on `ModelingApi` (worker API until M5b) | Phase 1 | NIST import, aligned/ordinate round trip, M5b |
| **Sketch entity → generated face/edge query** in the regen engine (persistent names, deterministic) | Phase 1 | sketch-dimension export, M5b (sketch dimensions shown in 3D), mate picks on sketch-driven faces |
| **Grouped issue report** (repeats collapse to one line with a count) | Phase 1 | PMI import, assembly STEP import, mate problems |
| **Capabilities, not device names**: `TierPolicy` answers "can edit sketches", "layout: review or full"; code stops asking `tier === 'phone'` (count with `grep -rlE "tier [!=]== 'phone'" apps packages --include='*.ts*'`) | Phase 2 | phone full editor, phone light edits, M6 and M5b UI with no new per-device branches |
| **Per-part-version cache** (display mesh, edges, names for picking, mass properties, mate frames) | Phase 3 (6.1) | lightweight assemblies, instant part open on phones, previews |
| **Annotation owner and model views**: annotations belong to a part or an assembly; a view (drawing or model view) places them | contract in 6.0, display in Phase 4 | assembly drawings, balloons and BOM, M5b |
| **Instance path on `EntityRef`** | 6.0 | mates, assembly drawings, assembly PMI, in-context references |

## 3. Order

**Phase 0 — housekeeping. Done** (Soak caller permission, the workflow permission check in CI,
agent files and brief per §5, ADR-101 and ADR-102). Open items are in §0 and §6.

**Phase 1 — finish PMI exchange (M5a). Done**, on main: PMI contract v2 (lead), NIST import
recovery (kernel), the sketch-entity query and sketch-dimension export (regen), the grouped
report and v2 mapping (app). Details: ADR-101 and its amendments, `PMI_VALIDATION.md`.

**Phase 2 — small, user-visible, and the groundwork for the rest.**
- 2a Capability policy; "Use full editor" on phones (the desktop layout at touch density).
- 2b "Save as project folder" beside the `.wrencad` download; a prompt when a `.wrencad` is
  saved inside a git repo. Parallel with 2a.
- 2c Phone light edits: feature values inline, configuration switch, save/compare/release
  versions. After 2a.
- In parallel, independent of all of the above: **spike S1, the mate solver** (candidates: a
  purpose-built rigid-body solver with DOF from the Jacobian rank; SolveSpace's solver built to
  Wasm). Output: `docs/spikes/`, a recommendation, a 25-part timing. Meanwhile the lead drafts
  the M6 contracts. The spike passes if a 25-part assembly re-solves within one frame (≤ 16 ms)
  while a part is dragged through a DOF, and from scratch in ≤ 100 ms, in Wasm on a desktop.
- Before 6.0: the audit of rule 9 in §4 (one cheap agent).

**Phase 3 — assemblies (M6), each slice released behind the preview setting.**
- 6.0 Contracts: `Assembly`, instances, mates, instance paths, the part cache record, assembly
  configurations, annotation owner. File format section and migration. The same revision takes
  the Phase 1 leftovers (§0): the four PMI and modeling additions and the datum-target kind.
- 6.1 Document model and file format; per-part-version cache.
- 6.2 Viewport: instanced drawing, picking that returns the instance path.
- 6.3 Insert, move, fasten; assembly tree. First usable slice.
- 6.4 Mate solver in: revolute, slider, cylindrical, planar, ball; DOF display; drag through DOF.
- 6.5 Mass and centre of mass, BOM, exploded views.
- 6.6 Assembly drawings (balloons, BOM table).
- 6.7 Assembly STEP export and import with per-part PMI (the façade's XCAF builder takes a
  product tree).
- 6.8 Assembly configurations, folders; the 500-instance test; certification assembly cases.
- Reviewer gate, then the preview setting is removed.

**Phase 4 — MBD in 3D (M5b).** Annotation planes, model views, annotations drawn and picked in
the viewport, edited with the drawing tools. Works on parts and assemblies because of 6.0. Also
datum targets: import (CTC 05) and the drawing symbol.

**Phase 5 — M7 hardening, then the simulation track.** Starts when the M6 and M5b reviewer gates
have passed.

## 4. Architecture rules

1. **Contracts first and additive.** New fields are optional; a schema version and migration
   only when a meaning changes. Contracts are frozen before agents start a phase.
2. **Capabilities, not device names** (§2).
3. **One way to point at geometry:** `EntityRef` and persistent names, with an instance path in
   assemblies. Never a stored index. Unresolved means "needs attention".
4. **The kernel façade stays coarse:** one C++ entry per operation, JSON in and out, every OCCT
   exception caught at the boundary. Part and assembly export share one XCAF builder.
5. **Derived data is a cache, never the document.** Keyed by part version, safe to delete.
6. **Operations declare what they need** (kernel, exact geometry, resolved parts). Lightweight
   assemblies and the phone's lazy kernel are the same mechanism.
7. **Tests are the contract.** A kernel change has goldens; an exchange change has per-model
   counts; a UI change has an E2E; budgets in PLAN §10 gate.
8. **Slices ship.** Every slice reaches main; unfinished areas sit behind a preview setting, not
   on a long-lived branch.
9. **Audit before M6** (one cheap agent): how many files does a new feature kind or annotation
   kind touch? If more than about six, add a registry first.

## 5. Agent workflow

Sources: Anthropic's multi-agent research post, context-engineering post, and the Claude Code
subagent, cost and prompt-caching docs (read 2026-11-23). Their numbers: an agent uses about 4×
the tokens of a chat, a multi-agent run about 15×, and most coding (shared context, many
dependencies) is a poor fit for fan-out.

**When to delegate.** Only work that is self-contained, has a test that defines done, and would
take the lead more than about ten tool calls. Small or iterative work stays with the lead. At
most three writing agents at once, on different packages, in worktrees, after the contract is
frozen.

**Tiers** (default in the agent file; the lead moves a task up one tier after a failed attempt):

| Tier | Agents and tasks |
| --- | --- |
| Lead (strongest model) | contracts, decomposition, merges, risky diffs, owner reports. Reads no raw logs. |
| opus, high effort | kernel (C++/OCCT), regen and naming, sketch solver, mate-solver spike, reviewer at gates |
| sonnet, medium effort | UI, viewport, document, platform, tests, io, drawing and sync; io, drawing and sync go up a tier for layout geometry or merge logic |
| haiku | docs, CI log triage ("which test, which error, ten lines"), baseline refreshes, code search |

**Brief** (every delegation): goal and why; files to read; the contract excerpt; the tests that
must pass; what is out of scope; the golden rules restated; a turn limit.
**Hand-back:** at most 300 words: what changed, tests run with counts, open risks, proposed
contract diffs. Test output is piped through `tail`; logs never come back whole.

**Verification.** The lead runs the tests or reads CI; a report is not evidence. The reviewer
runs at milestone gates and before risky merges, and is given the diff, not the conclusion.

**Context and cache.** One session per phase, started from this file. The lead's model is not
switched mid-session (a switch re-reads the whole context uncached). CI is checked once at its
expected finish, not polled. An agent gets everything it needs up front, because its cache
expires after five idle minutes.

## 6. Pending owner checks and small backlog

- PMI validation with the NIST STEP File Analyzer and one third-party CAD tool
  (`PMI_VALIDATION.md`). 3D mouse tilt left/right after the reverse switches.
- Tablet command bar clips at 744 px with a panel open; unused ToolRail; 6 desktop m4-toolbar
  baselines; long-press timing from event timestamps; `actionlint` in CI (a workflow that cannot
  start should fail on the push that breaks it); drag perf probe on a quiet machine; datum triangle overlaps the outside arrowhead on linear
  dimensions.
