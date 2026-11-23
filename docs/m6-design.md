# M6 design: assembly contracts (draft for slice 6.0)

> Draft by the lead, 2026-11-23, written while Phase 2 runs (NEXT.md §3). Not landed: the contract
> commit is slice 6.0, after spike S1 (`docs/spikes/mate-solver.md`) fixes the mate and result
> shapes and after the rule 9 audit. Sections marked **open** need the spike or the owner.

All of it is additive except the `Assembly` placeholder gaining fields, which no stored document
uses yet (`assemblies` is always `[]`). `SCHEMA_VERSION` goes 4 → 5 only because a v4 reader
would drop an assembly on save; the migration is the identity.

## 1. Document (`document.ts`)

```ts
/** M6. A set of placed instances of parts and of other assemblies, held together by mates. */
export interface Assembly {
  id: Id;
  name: string;
  /** Order is the tree order; it carries no geometric meaning. */
  instances: Instance[];
  /** Kept sorted by id (as annotations), so concurrent adds never conflict on order. */
  mates: Mate[];
  /** Display grouping only (not sub-assemblies). Components and mates each have their own. */
  folders?: { instances?: AssemblyFolder[]; mates?: AssemblyFolder[] };
  properties?: PartProperties;
  /** Sparse overrides over an implicit Default, as `Part.configurations` (ADR-074). */
  configurations?: AssemblyConfiguration[];
  activeConfigurationId?: Id;
  /** Annotations that measure the assembly (M5b draws them). Sorted by id. */
  annotations?: Annotation[];
  explodedViews?: ExplodedView[];
}

export interface Instance {
  id: Id;
  /** Shown in the tree; default "<part name> <n>". */
  name: string;
  of: { kind: 'part'; partId: Id } | { kind: 'assembly'; assemblyId: Id };
  /** The part or sub-assembly configuration used; absent = its Default (never "its active"). */
  configurationId?: Id;
  /**
   * Where the instance is when no mate moves it, and the solver's starting pose. The solver's
   * result is derived data (rule 5) and is not written here; a drag through a free DOF is.
   */
  placement: Frame;
  /** Fixed to the assembly frame: the solver may not move it. The first instance defaults to true. */
  fixed?: boolean;
  suppressed?: boolean;
  hidden?: boolean;
  /** Overrides the part's colour for this instance. */
  color?: string;
}

/** A contiguous run is not required here (unlike feature folders): order has no meaning. */
export interface AssemblyFolder {
  id: Id;
  name: string;
  members: Id[];
  collapsed?: boolean;
}
```

A sub-assembly is rigid in its parent in M6 (its own mates are solved in its own frame). A cycle
(`A` contains `B` contains `A`) is refused by the command layer and reported by `check`.

## 2. Pointing at geometry: the instance path

```ts
export interface EntityRef {
  name: string;
  kind: EntityKind;
  fingerprint?: Fingerprint;
  /**
   * M6: the instances from the owning assembly down to the part the name belongs to, outermost
   * first (`[subAssemblyInstanceId, partInstanceId]`). Absent = the ref is in its own part.
   */
  path?: Id[];
}
```

One field, optional, so every existing ref and every part-level consumer is unchanged (rule 3).
Resolution is two steps: the path gives the part, its configuration and the accumulated
transform; the name then resolves in that part exactly as today. An instance that no longer
exists, or a name that no longer resolves, is "needs attention", never a guess.

## 3. Mates

```ts
export type MateType = 'fasten' | 'revolute' | 'slider' | 'cylindrical' | 'planar' | 'ball';

export interface Mate {
  id: Id;
  name: string;
  type: MateType;
  /** Two connectors. Each is a frame on one instance; the mate type says how the frames relate. */
  a: MateConnector;
  b: MateConnector;
  /** Turn `b` over (Z reversed) and rotate about Z: the usual "flip" and "reorient" choices. */
  flip?: boolean;
  /** Offsets between the two frames along the mate's free or fixed axes. Expressions with units. */
  offset?: { distance?: Expr; angle?: Expr };
  /** P2 (PLAN §2.3): limits on the free DOF. Reserved so 6.4 does not need a revision. */
  limits?: { distance?: [Expr | null, Expr | null]; angle?: [Expr | null, Expr | null] };
  suppressed?: boolean;
}

/**
 * A frame derived from picked geometry, so it follows the part when it changes. `ref.path` names
 * the instance. `at` picks the point on the entity: a planar face's centroid, a cylinder's axis
 * at its mid height, a circular edge's centre, a vertex.
 */
export interface MateConnector {
  ref: EntityRef;
  at?: RefPoint;
}
```

**Settled by S1** (`docs/spikes/mate-solver.md`): the joint form is what the solver takes. Each
connector reduces to a mate frame (origin, x, z) read from the part cache; each joint type is a
fixed set of residuals between two frames. The solver is a purpose-built TypeScript rigid-body
solver (no Wasm, no dependency); the prototype is in `spikes/mates/`.

What the spike adds to this draft:

- The stored `placement` matters more than "a starting pose": it is what keeps a linkage in the
  same assembly mode (a four-bar started far from its solution lands in the other mode 10 to
  48% of the time). So a solved pose is written back to `placement` when a drag or a mate edit
  ends (one undo step), and creating a mate first places the moved instance onto the mate in
  closed form, then solves.
- Fastened instances are clustered into one body before solving (25 parts became 17 bodies).

## 4. The per-part-version cache record (rule 5)

Keyed by `partId`, the resolved configuration and a hash of the part's inputs (features, the
parameters it reads, schema and kernel versions). Stored in `.wren/` and IndexedDB, never synced,
safe to delete.

```ts
export interface PartCacheRecord {
  key: string;
  /** Display mesh and edges per body (the existing mesh cache payload). */
  mesh: MeshPayloadRef;
  /** Face, edge and vertex names by mesh range, for picking with no kernel. */
  names: NameTableRef;
  mass?: { volume: number; area: number; centroid: Vec3; inertia: [Vec3, Vec3, Vec3] };
  bounds: { min: Vec3; max: Vec3 };
  /**
   * The frame of every entity a mate connector can use (planar faces, cylinders, cones, circular
   * and straight edges, vertices), by persistent name. This is what lets mates solve and DOF be
   * shown with no B-rep loaded.
   */
  frames: Record<string, { kind: EntityKind; frame: Frame; radius?: number }>;
}
```

**Open:** frames for every candidate entity can be large on a 5,000-face import. Options: all of
them (simple, measured in 6.1), or only planar, cylindrical and circular entities plus any entity
a mate already uses. Decide from a measurement on the NIST models in 6.1.

## 5. Solving (`modeling.ts`, worker API)

```ts
export interface AssemblySolveResult {
  /** Solved transform per instance path, as a Frame in the assembly's frame. */
  transforms: Record<string, Frame>;
  /** Remaining degrees of freedom of the whole assembly and per instance. */
  dof: { total: number; instances: Record<Id, number> };
  mates: Record<Id, { status: 'ok' | 'redundant' | 'conflict' | 'unresolved'; with?: Id[]; reason?: string }>;
}

/** What an operation needs (rule 6); the same declaration drives the phone's lazy kernel. */
export type Needs = 'nothing' | 'kernel' | 'resolvedParts';
```

The solver does not use the kernel, so it can run in its own small worker (the main thread never
touches Wasm, and never blocks on a solve either). From S1: the result also carries, per
instance, rotational and translational DOF separately, and per mate the position and angle
error, the count of redundant equations and the mates involved; a drag step is its own call that
re-solves only the dragged component. Measured (Node, 2.3 GHz Xeon, median): 25 parts from
scratch 1.2 ms, a drag frame 0.2 ms; 501 instances from scratch 10 ms. Known limits to fix in
6.4: the DOF analysis is dense (a single 100-body loop takes about 0.5 s; needs a sparse or
spanning-tree analysis), a 500-body single chain drags at 14 ms median, tolerances need a
per-body scale, and a planar loop of revolutes always reports three redundant equations, which
is information, not a warning.

## 6. Annotations, drawings, configurations

```ts
/** drawing.ts: widens. */
export type DrawingSubject =
  | { kind: 'part'; partId: Id }
  | { kind: 'assembly'; assemblyId: Id; configurationId?: Id; explodedViewId?: Id };

export interface AssemblyConfiguration {
  id: Id;
  name: string;
  /** Per instance: suppressed, and which configuration of its part it uses. */
  instances?: Record<Id, { suppressed?: boolean; configurationId?: Id | null }>;
  /** Per mate: suppressed, and its offset values. */
  mates?: Record<Id, { suppressed?: boolean; offset?: { distance?: Expr; angle?: Expr } }>;
  properties?: PartProperties;
}

export interface ExplodedView {
  id: Id;
  name: string;
  /** Ordered steps; each moves some instances along a direction in the assembly frame. */
  steps: { instances: Id[]; direction: Vec3; distance: Expr }[];
}
```

An annotation's owner is where it is stored (`Part.annotations` or `Assembly.annotations`); its
refs carry a `path` when the owner is an assembly. No owner field is added. Balloons and the BOM
table are drawing items (6.6), not model annotations.

## 7. Phase 1 leftovers taken by the same revision

- `PmiIssueCode`: the union of the codes the façade already writes, replacing `string`.
- `perUnit` on PMI tolerance items and `modifiers` on PMI dimensions.
- `ModelingApi.sketchGenerated` (the query exists in the regen engine since 1c).
- `DatumTargetAnnotation` (point, line or area target, with its datum letter and index); import
  and the drawing symbol are Phase 4.

## 8. File format

`assemblies/<slug>.assembly.json` already has a manifest slot (`ProjectManifest.assemblies`).
Canonical JSON as every other file; `instances` in tree order, `mates` and `annotations` sorted
by id. Merge is keyed by id at every level, so adding an instance on one branch and a mate on
another merges cleanly.

## 9. Owner questions

1. Sub-assemblies rigid in the parent for M6 (flexible later)? Recommended: yes.
2. `Instance.configurationId` absent means the part's Default, not whatever is active in the
   part. Recommended: yes (an assembly must not change when someone switches a part's view).
3. A drag through a free DOF is an undoable document edit of `placement`. Recommended: yes, one
   undo step per drag.
