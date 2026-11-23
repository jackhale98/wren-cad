# Spike S1: the assembly mate solver

Date: 2026-11-23 · NEXT.md Phase 2 (S1), Phase 3 slice 6.4 · PLAN §2.3, M6 ("lightweight by
default") · Code: [`spikes/mates/`](../../spikes/mates) (outside the pnpm workspace, not run by
`pnpm test`, no dependencies)

## Headline

**Recommendation: candidate A, a purpose-built rigid-body solver in TypeScript.** The prototype
handles the six mate types. It reports the assembly DOF and the DOF of each instance, names
redundant mates and the mates that imply them, and shrinks conflicts to a minimal set with a
plain-language message. Drag frames keep every mate exact. It uses only the cached mate frames
(origin, x, z in part coordinates), so it works on lightweight assemblies with no B-rep and no
kernel. It is about 1,600 lines of plain TypeScript (solver, linear algebra, types; the models, tests and bench add 840 more), adds no dependency, and has no licence or
Wasm-size cost.

- **Speed (this machine, Node, single thread):** for 25 parts a drag frame takes **0.21 ms median
  / 0.25 ms p95** (budget 16 ms). A solve from scratch with DOF and statuses takes **1.1 ms
  median / 3.3 ms p95** (budget 100 ms). For 501 instances a solve from scratch takes 10 ms, and
  a drag frame 0.03 ms, because only the dragged component is solved.
- **Correctness:** 33 tests in 7 suites pass. They cover every mate type alone (DOF, rotational
  and translational split), flip and offset, a start exactly 180° off, a four-bar (1 DOF), a
  slider-crank dragged past its stroke, a fastened stack, consistent and conflicting redundancy,
  a coupler too long to close, a 25-part assembly with 4 loops (14 DOF), 501 instances (100 DOF),
  a 100-link chain (92 DOF), 2,000 drag frames (quaternions stay unit, results deterministic) and
  coordinates at 1e6 mm.
- **SolveSpace (B):** rejected. Its public API solves points and normals, not rigid bodies. We
  would have to build bodies, per-body DOF and mate-level failure reporting on top of it. No
  maintained Wasm build is known (unverified).
- **planegcs:** rejected. It is 2D only.

Weak spots, measured: the DOF analysis is dense. It takes 0.5 s on a single 100-body loop
component, and a drag frame in one 500-body component takes 17 ms median. Neither affects the
25-part or 501-instance targets, but production needs the sparse analysis described below.

## Candidates

| | A: purpose-built TS | B: SolveSpace libslvs → Wasm | planegcs (in repo) |
| --- | --- | --- | --- |
| Model | rigid bodies (quaternion + pivot), mates as residual rows between frames | points (3 params), normals (quaternion), workplanes; constraints between them | 2D points, lines, arcs, conics |
| Bodies | native; fasten groups merged in closed form | not in the public API (unverified); emulate with extra entities and constraints, or fork to expose its transformed-entity groups | n/a (2D) |
| DOF | per assembly, per instance, rotational/translational split, from the Jacobian rank | one `dof` count for the system (unverified); no per-body DOF | 2D only |
| Failure report | per mate: redundant (with implying mates) or conflict (minimal set), errors in mm and degrees, message | result code plus a list of "failed" constraints when asked (unverified) | sketch-level |
| Licence | ours (GPL-3.0-or-later) | GPL-3.0-or-later (unverified); compatible with Wren | LGPL-2.0-or-later (verified, `node_modules`) |
| Size / deps | ~1.6k lines TS, 0 deps, no Wasm | C++ build to Wasm, size unknown; no maintained Wasm/JS build known (unverified) | wasm 173 KB gzip (DEPENDENCIES.md) |
| Runs | any worker; no Wasm, so no cross-origin or memory concerns | Wasm in a worker | Wasm in a worker |

**Why A.** The data Wren has in lightweight mode is exactly what A consumes: one frame per
mated face, edge or connector, from the part cache. The results the UI needs map onto bodies:
which instances still move, which way, and which mate to fix. With A these come straight out of
the solver. With B they would be rebuilt by mapping points and normals back to bodies, and the
failure list back to mates. We control every behaviour the UX depends on: drag feel, branch
stability, which mate gets blamed, tolerances. The measured speed leaves about 60× headroom on
the 25-part drag budget.

**Why not B** (all from memory; nothing could be fetched). libslvs is a good general geometric
solver, but it solves in groups over points and normals. A rigid instance with k mate frames
becomes k points and k normals tied together by distance and angle constraints, or a fork that
exposes SolveSpace's internal transformed-point entities. Either way the unknowns grow with frame
count rather than body count. Its DOF count is for the whole system, so per-instance DOF (needed
for DOF colouring) would still be our code. Its solver uses dense matrices and has a fixed limit
on unknowns (unverified; historically on the order of a thousand or two). With frame inflation
that limit is near the 500-instance target. It would also add a C++-to-Wasm build to maintain.
The licence is not the blocker.

**Why not planegcs.** Its primitives are 2D (`point` has x and y; checked in
`node_modules/@salusoft89/planegcs@1.3.0`). It has no 3D rotation and no rigid bodies. It stays
the sketch solver.

Also known but not assessed: OndselSolver, the multibody solver behind FreeCAD 1.0's Assembly
workbench (LGPL, C++; unverified). It would need a Wasm build and was not a candidate.

## What the prototype does

- **Unknowns.** One rigid body per fasten cluster. Fasten mates are merged by union-find in
  document order, and the members' relative transforms are computed in closed form. A fasten
  that closes a loop is checked in closed form: redundant if it agrees, a conflict naming the
  loop if it does not. A body's pose is a unit quaternion plus the world position of a
  **pivot** at the centroid of its mate frames, not the part origin, which keeps lever arms
  short. Each step is an incremental rotation vector applied by the exponential map and then
  renormalised, so there are no Euler angles and no gimbal lock.
- **Mates as rows**, between A's frame and B's target frame B' (B with offset along z, angle
  about z and flip applied):

  | Mate | Equations | Rows used for analysis | Extra rows used only for solving |
  | --- | --- | --- | --- |
  | fasten | 6 | (A.o−B'.o)·{x,y,z}; (A.z−B'.z)·{x,y}; (A.x−B'.x)·y | (A.z−B'.z)·z; (A.x−B'.x)·{x,z} |
  | revolute | 5 | origin·{x,y,z}; z·{x,y} | z·z |
  | slider | 5 | origin·{x,y}; z·{x,y}; x·y | z·z; x·{x,z} |
  | cylindrical | 4 | origin·{x,y}; z·{x,y} | z·z |
  | planar | 3 | origin·z; z·{x,y} | z·z |
  | ball | 3 | origin·{x,y,z} | none |

  The analysis rows are minimal: one per equation, so rank counting is exact. The extra rows
  complete the difference vector A.z − B'.z. Its norm, 2·sin(θ/2), rises steadily up to 180°.
  With the minimal rows alone, the error is cos θ, which is stationary at 90° and would stall
  the solve far from the solution.
- **Solve.** Levenberg-Marquardt is run on each connected component of free bodies (grounded
  bodies carry no unknowns, so they split components). The damped normal equations
  (JᵀJ + λI)δ = −Jᵀr are solved by a **block-sparse Cholesky** with 6×6 blocks. Its
  minimum-degree ordering and fill pattern are built once per component. Each step is limited to
  0.5 rad of rotation, or 0.5 of the model extent in translation. If the solve stalls, it is
  restarted up to 3 times with a small deterministic rotation. This is needed because a start
  exactly 180° off is a stationary point (tested).
- **Scaling.** Translations and position rows are divided by L, the RMS lever arm from pivot
  to frame over the free bodies, so all Jacobian entries are O(1). Using the whole-model extent
  instead made the damping swamp the rotation columns in long chains: 12 iterations per drag
  frame instead of 5.4, measured.
- **Drag.** One frame has two stages. First, up to 4 LM iterations on the mate rows plus 3 soft
  rows pulling the grabbed point toward the pointer (weight 0.1). Second, up to 12 iterations on
  the mate rows alone, which projects back onto the mates exactly. The LM damping term λ‖δ‖²
  keeps motion small: in free directions it means "move as little as possible from the last
  pose". The step limit is 0.2 rad per iteration while dragging, which keeps the linkage on its
  branch. Only the dragged component is solved.

## DOF, redundancy and conflicts

- **DOF of an assembly** = Σ over components of (6 × free bodies − rank of the analysis rows).
  The rank comes from modified Gram-Schmidt over the rows in mate order, run twice per row.
  A row is dependent when its remainder is below **RANK_TOL = 1e-7** (absolute, scaled units).
- **DOF of an instance** is the rank of its 6 rows of the null-space basis, with tolerance 1e-6.
  It is the dimension of the motions the mates still allow that instance, including motion that
  comes from other bodies (a four-bar coupler has 1). `rotational` is the rank of the 3 rotation
  rows, and `translational = total − rotational` counts pure translations: cylindrical gives
  (1, 1), planar (1, 2). These are the numbers for DOF colouring and for the arrows of "drag
  through DOF".
- **Redundancy.** For a dependent row, the solver records its unique combination of earlier
  kept rows, using a triangular provenance matrix. The kept rows are independent, so the support
  of that combination is the one minimal set of earlier rows that implies it. The mate that owns
  the row is `redundant`, `involved` lists the mates in the support, and `redundantEquations`
  counts its dependent rows. Example: a four-bar of revolutes gives "'rev-4' has 3 of its 5
  conditions already set by 'rev-1', 'rev-2', 'rev-3'". The later mate in document order is
  always the one blamed.
- **Consistency.** Each dependency gives a left null vector y with Jᵀy = 0. If |y·r| is above
  **CONFLICT_TOL = 1e-6**, the linearised equations are inconsistent; if it is below, the
  redundancy is consistent.
- **Conflicts.** The solver detects a conflict when LM does not converge (SOLVE_TOL = 1e-10 on
  every row). Candidates come from the inconsistent dependencies at the least-squares minimum,
  retried at 1e-4 and 1e-2 when the minimum sits slightly off a singular pose. If none are found,
  every mate in the component is a candidate. A **deletion filter** then drops each mate whose
  removal leaves the set unsolvable, so the result is minimal: removing any one of its mates
  makes the rest solvable. Its last mate is set aside and the rest are solved, so the user sees
  a sensible pose. The error the set-aside mate is left with goes into the message. Repeated up
  to 8 times per component. Mates with no unknowns are checked in closed form: mates inside a
  fasten cluster blame the fasten path, and mates between two grounded instances say so.
- **Messages** (verbatim from the prototype):
  - *"'rail-2' (slider, carriage to base) adds nothing beyond 'rail-1'. It holds now, but if one
    of these values changes they will conflict. Consider suppressing it or using a mate that
    removes fewer degrees of freedom."*
  - *"These 2 mates cannot all hold: 'rail-1' (slider, carriage to base); 'rail-2' (slider,
    carriage to base). Without 'rail-2' the rest solve; with it, it is 5.000 mm off. Suppress or
    edit any one of them."*
  - A coupler 200 mm too long gives the four revolutes; "70.361 mm off". 44 ms including the
    deletion filter.
- **Near-singular poses.** A warning is raised when the smallest kept pivot is below 1e-4, for
  example a linkage at toggle, where the DOF count can change with a small move.

## Measurements

Intel Xeon @ 2.30 GHz (4 logical CPUs, shared VM), Node v22.23.5, single thread,
`node --experimental-strip-types spikes/mates/bench/bench.ts`. The first 10 solves and 50 frames
are discarded (JIT warm-up). Starting poses are perturbed by up to 5 mm and 5°. The max column
includes GC pauses and VM noise.

| Case | Runs | Median ms | p95 ms | Max ms | Notes |
| --- | --- | --- | --- | --- | --- |
| **25 parts, from scratch (poses + DOF + statuses)** | 300 | **1.07** | **3.31** | 8.21 | 17 bodies, 6 comps (largest 5); DOF 14 |
| 25 parts, from scratch, poses only | 300 | 0.60 | 3.06 | 11.1 | |
| 25 parts, from scratch, fasten not clustered | 300 | 1.24 | 3.55 | 8.54 | 25 bodies, 10 comps |
| **25 parts, drag frame (six-bar crank)** | 2000 | **0.21** | **0.25** | 7.54 | 6.4 LM its/frame; mates within 2e-9 mm |
| 25 parts, drag frame + re-solve all components | 2000 | 0.26 | 0.32 | 4.42 | |
| 25 parts, drag frame, fasten not clustered | 2000 | 0.22 | 0.40 | 4.46 | |
| 25 parts, drag frame (spatial RSSR coupler) | 2000 | 0.11 | 0.16 | 5.98 | |
| **501 instances, from scratch (poses + DOF)** | 50 | **10.0** | **15.1** | 16.3 | 101 bodies, 100 comps; DOF 100 |
| 501 instances, from scratch, fasten not clustered | 20 | 40.9 | 100.9 | 100.9 | 501 bodies |
| **501 instances, drag frame (one lever)** | 2000 | **0.029** | **0.053** | 4.73 | |
| 501 instances, drag frame + re-solve all components | 500 | 0.76 | 2.26 | 5.81 | |
| chain of 100 (one component), from scratch (poses + DOF) | 20 | 520 | 699 | 699 | dense analysis dominates |
| chain of 500 (one component), from scratch, poses only | 20 | 32.4 | 60.5 | 60.5 | 7 LM its |
| chain of 500 (one component), drag frame | 200 | 16.7 | 27.3 | 35.8 | 5.4 LM its/frame |

The NEXT.md thresholds (25 parts: drag re-solve ≤ 16 ms, from scratch ≤ 100 ms) pass with about
60× and 30× headroom at p95.

**Robustness from rough placement** (100 seeds each; script not committed, the same loop as
the bench):

| Start error | 25-part converges, 14 DOF | False conflicts | Four-bar lands in the other assembly mode |
| --- | --- | --- | --- |
| 5 mm / 5° | 100% | 0 | 0% |
| 20 mm / 20° | 100% | 0 | 0% |
| 50 mm / 45° | 100% | 0 | 0% |
| 100 mm / 90° | 97% | 3 | 10% |
| 200 mm / 180° | 80% | 20 | 48% |

## Numerical risks

1. **Quaternion drift and gimbal lock.** Neither occurs: updates use an incremental rotation
   vector, followed by renormalisation with w ≥ 0. After 2,000 drag frames |q| − 1 < 1e-12
   (tested).
2. **Stationary start (exactly 180° off).** The axis residual has a saddle there. The solver
   restarts with a deterministic 0.05 rad nudge (tested).
3. **Rank tolerance.** The tolerance is absolute, on rows scaled by one global L. If one model
   mixes 1 mm and 10 m lever arms, row norms span 1e4 and a near-dependent row could be
   misjudged. Production should scale each body by its own lever arm. Near toggle positions the
   DOF really does change, so the solver reports the singular-pose warning instead of hiding it.
4. **Branch choice and flipping.** Axis direction is never a branch, because `flip` is explicit
   in the mate and the difference residual has a single zero. Assembly modes of loops (open or
   crossed four-bar) are chosen by the start pose. From under 45° of error the mode was always
   kept; from rough starts it flipped (table above). During a drag the 0.2 rad step limit kept
   the mode for a 40° sweep and 2,000 frames (tested). In production: always solve from the
   stored last pose, and on mate creation snap the moved part onto the new mate in closed form
   before running LM.
5. **False conflicts.** Local minima from very rough starts (3% at 90°) look like conflicts.
   Before reporting one, production should retry from a closed-form spanning-tree placement.
6. **Large coordinates.** Positions are float64 and rotation is about the body pivot. At 1e6 mm
   the mates hold within 1e-6 mm (tested). The GPU needs camera-relative float32, which is a
   viewport concern.
7. **Who gets blamed.** Blame depends on mate order: the later mate is redundant. The involved
   set is exact, but a user may expect another mate to be blamed. A planar loop built only of
   revolutes is always 3 equations redundant, out of plane. Show that as info, not as a warning.
   Other CAD tools accept it silently (unverified).
8. **Cost of the analysis.** It is dense: O(m·n·rank) per component. That is fine for typical
   components (clustering and grounding split assemblies into small pieces) but takes 0.5 s for
   a single 100-body loop. It runs when mates change, never per frame.

## What production needs beyond the spike

- Rewrite the row evaluation to use typed arrays with no allocation; it currently allocates
  small arrays per row (estimate: 2–3× on large components, unverified). Expected to bring the
  500-body single-component drag under 16 ms. Separately, let the worker drop frames: if a
  solve is still running when the next pointer move arrives, solve only for the latest target.
- **Sparse analysis:** a sparse rank-revealing QR (Givens on block rows in elimination order),
  or a spanning-tree reduction where tree mates are independent by construction and only
  loop-closing mates are rank-tested. Either replaces the dense Gram-Schmidt.
- Closed-form snap on mate creation, spanning-tree initialisation before declaring a conflict,
  and incremental re-solve on mate edits.
- Mate values as expressions (offset and angle already work as numbers). Later: limits as
  inequality rows (active set), gears and racks as linear coupling rows between relative
  angles or translations, and motion study by driving a DOF.
- Sub-assemblies (rigid = one body; flexible = their mates join the parent's system).
  Configurations (suppression and mate values per configuration, then re-solve).
- Default grounding (first inserted instance) and a "float" command. Per-body scaling. Severity
  policy: consistent redundancy as info, partial redundancy as a warning, conflict as an error.
- Runs in a worker: a small assembly worker, or the document worker. It needs no Wasm and no
  kernel. Drag protocol: post `{instance, grab, target}`, receive a transferable
  `Float64Array` of 7 numbers per moved instance (q, p).

## What the solver needs from the contract (proposal for 6.0)

```ts
/** In the per-part-version cache, keyed by persistent face/edge name (lightweight, no B-rep). */
interface MateFrame { origin: Vec3; x: Vec3; z: Vec3 }    // part coords, mm, orthonormal; y = z × x
// plane: origin on the face, z = outward normal, x = a stable in-plane direction (deterministic
// across part versions, e.g. surface u direction); axis (cylinder, cone, circular edge): origin
// on the axis, z = axis; point (vertex, sphere centre): origin, x/z = part axes. Plus explicit
// mate connectors, which are user-placed frames.

interface MateEndRef { instancePath: InstancePath; ref: EntityRef }  // resolved → MateFrame
type MateType = 'fasten' | 'revolute' | 'slider' | 'cylindrical' | 'planar' | 'ball';
interface Mate {
  id: string; name?: string; type: MateType; a: MateEndRef; b: MateEndRef;
  flip?: boolean;          // target = B rotated 180° about its x (z opposed)
  offset?: Expr;           // along B.z (planar gap; fasten/revolute offset)
  angle?: Expr;            // about B.z (fasten, slider; later the revolute angle value)
  suppressed?: boolean;    // per configuration
  // later: limits?: { min?: Expr; max?: Expr }; gear/rack as separate relation kinds
}
interface InstanceState { pose: { q: Quat; p: Vec3 }; grounded?: boolean }  // stored in the
// document: it is the solver's start point (branch memory) and the lightweight-open result

interface MateSolveResult {
  converged: boolean;
  poses: Record<InstanceId, { q: Quat; p: Vec3 }>;   // a Float64Array on the wire
  dof: number;
  instanceDof: Record<InstanceId, { total: number; rotational: number; translational: number }>;
  mates: Record<MateId, { status: 'ok' | 'redundant' | 'conflict' | 'unsolved';
    redundantEquations: number; involved: MateId[]; positionError: number /* mm */;
    angleError: number /* deg */; message?: string }>;
  conflicts: { mates: MateId[]; message: string }[];  // each set minimal
  warnings: string[];                                  // near-singular pose, and so on
}
```

An unresolved `MateEndRef` makes the mate "needs attention". It is never guessed. The solver
then leaves that mate out and says so. The prototype's shapes are in
`spikes/mates/src/types.ts`.

## Unverified claims

All claims about SolveSpace and libslvs are from memory; there was no network access. That
covers: GPL-3.0-or-later licence; the public `slvs.h` entities (points, normals, workplanes,
lines, circles, arcs, distances) and the lack of a body or transform entity; the single `dof`
count; result codes (okay, inconsistent, didn't converge, too many unknowns) and the "failed
constraints" list; the dense solver and its limit on unknowns; the existence of an experimental
Emscripten build of the SolveSpace app and Python bindings; the absence of a maintained npm Wasm
package; the Wasm size. Also unverified: OndselSolver's licence and role; how other CAD tools
treat consistent redundancy; the 2–3× speed-up estimate for an allocation-free row evaluation.

Verified here: planegcs 1.3.0 is LGPL-2.0-or-later with 2D primitives only (`node_modules`).
Every timing and test result above was measured on this machine.

## How to run

```sh
node --experimental-strip-types --test spikes/mates/test/mates.test.ts   # 33 tests
node --experimental-strip-types spikes/mates/bench/bench.ts              # timing table
```
