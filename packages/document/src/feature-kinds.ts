// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * One definition per feature kind (ADR-101, slice 2d, features). The per-kind facts that used to be
 * repeated across packages (which fields are expressions and their dimension, which topology refs a
 * kind holds, the labels of its values, its configurable options, whether it is reference geometry)
 * are entries of `FEATURE_DEFS`. The mapped type is compile-time complete: a kind added to the
 * `Feature` union without an entry here fails typecheck. Per-kind *code* (regen, inspector forms,
 * factories, fake modeling) stays where it is, in switches with no `default`.
 */

import type {
  ConfiguredValue,
  EntityRef,
  Feature,
  FeatureType,
  SketchConstraint,
} from '@wren-cad/contracts';
import type { ExprField } from './features';
import { HOLE_TABLES } from './hole-tables';

type Of<K extends FeatureType> = Extract<Feature, { type: K }>;

/** A configurable option (enum / boolean) field of a feature type. */
export interface ConfigurableOption {
  /** JSON pointer inside the feature. */
  pointer: string;
  /** Short UI label. */
  label: string;
  /** The allowed values, or a function of the feature when they depend on it (hole sizes). */
  values: readonly ConfiguredValue[] | ((feature: Feature) => readonly ConfiguredValue[]);
}

export interface FeatureDef<K extends FeatureType> {
  readonly type: K;
  /** Display name (the feature tree and inspector title): `Linear pattern`. */
  readonly label: string;
  /** Plane, axis and point: reference geometry with a viewport eye (ADR-093). */
  readonly isReference: boolean;
  /** Inspector/phone label of each `Expr` field, by JSON pointer. Unlisted pointers fall back. */
  readonly valueLabels: Readonly<Record<string, string>>;
  /** Option fields a configuration may override (D2); `Expr` fields are configurable as well. */
  readonly options: readonly ConfigurableOption[];
  /** `Expr` fields with the dimension each must have. Reads only the feature's own fields. */
  exprFields(f: Of<K>): ExprField[];
  /** Every persistent topology reference the feature holds, in a fixed order. */
  refs(f: Of<K>): EntityRef[];
}

const OPS = ['new', 'add', 'cut', 'intersect'] as const;
const DIRECTIONS = ['normal', 'reverse', 'symmetric'] as const;
/** `upTo` needs a topological target, so it is not a configurable end kind. */
const END_KINDS = ['blind', 'throughAll'] as const;
const BOOLS = [true, false] as const;

const holeSizes = (f: Feature): readonly ConfiguredValue[] =>
  f.type === 'hole' || f.type === 'thread'
    ? (HOLE_TABLES[f.standard]?.rows.map((r) => r.size) ?? [])
    : [];

const constraintExpected = (c: SketchConstraint): 'angle' | 'length' =>
  c.kind === 'angle' ? 'angle' : 'length';

/** The body references of a `scope` of `bodies`. */
const scopeRefs = (s: { kind: string; bodies?: EntityRef[] } | undefined): EntityRef[] =>
  s && s.kind === 'bodies' && s.bodies ? s.bodies : [];

export const FEATURE_DEFS: { readonly [K in FeatureType]: FeatureDef<K> } = {
  primitive: {
    type: 'primitive',
    label: 'Primitive',
    isReference: false,
    valueLabels: {
      '/dx': 'Size X',
      '/dy': 'Size Y',
      '/dz': 'Size Z',
      '/radius': 'Radius',
      '/height': 'Height',
    },
    options: [{ pointer: '/op', label: 'Operation', values: OPS }],
    exprFields: (f) => {
      switch (f.shape) {
        case 'box':
          return [
            { pointer: '/dx', expected: 'length' },
            { pointer: '/dy', expected: 'length' },
            { pointer: '/dz', expected: 'length' },
          ];
        case 'cylinder':
          return [
            { pointer: '/radius', expected: 'length' },
            { pointer: '/height', expected: 'length' },
          ];
        case 'sphere':
          return [{ pointer: '/radius', expected: 'length' }];
      }
      return [];
    },
    refs: (f) => [...scopeRefs(f.scope)],
  },
  sketch: {
    type: 'sketch',
    label: 'Sketch',
    isReference: false,
    valueLabels: {},
    options: [],
    exprFields: (f) => {
      const out: ExprField[] = [];
      f.constraints.forEach((c, i) => {
        if (!('value' in c)) return;
        out.push({
          pointer: `/constraints/${i}/value`,
          expected: constraintExpected(c),
          constraintId: c.id,
          driven: !c.driving,
        });
      });
      return out;
    },
    refs: (f) => {
      const refs: EntityRef[] = [f.on];
      for (const e of f.entities) if (e.source) refs.push(e.source.ref); // M3 linked entities
      return refs;
    },
  },
  extrude: {
    type: 'extrude',
    label: 'Extrude',
    isReference: false,
    valueLabels: { '/end/depth': 'Depth', '/draft': 'Draft angle' },
    options: [
      { pointer: '/end/kind', label: 'End type', values: END_KINDS },
      { pointer: '/direction', label: 'Direction', values: DIRECTIONS },
      { pointer: '/op', label: 'Operation', values: OPS },
    ],
    exprFields: (f) => {
      const out: ExprField[] = [];
      if (f.end.kind === 'blind') out.push({ pointer: '/end/depth', expected: 'length' });
      if (f.draft !== undefined) out.push({ pointer: '/draft', expected: 'angle' });
      return out;
    },
    refs: (f) => {
      const refs: EntityRef[] = [...f.profile];
      if (f.end.kind === 'upTo') refs.push(f.end.target);
      refs.push(...scopeRefs(f.scope));
      return refs;
    },
  },
  revolve: {
    type: 'revolve',
    label: 'Revolve',
    isReference: false,
    valueLabels: { '/angle': 'Angle' },
    options: [
      { pointer: '/direction', label: 'Direction', values: DIRECTIONS },
      { pointer: '/op', label: 'Operation', values: OPS },
    ],
    exprFields: () => [{ pointer: '/angle', expected: 'angle' }],
    refs: (f) => [...f.profile, f.axis, ...scopeRefs(f.scope)],
  },
  fillet: {
    type: 'fillet',
    label: 'Fillet',
    isReference: false,
    valueLabels: { '/radius': 'Radius' },
    options: [{ pointer: '/propagate', label: 'Propagate', values: BOOLS }],
    exprFields: () => [{ pointer: '/radius', expected: 'length' }],
    refs: (f) => [...f.edges],
  },
  chamfer: {
    type: 'chamfer',
    label: 'Chamfer',
    isReference: false,
    valueLabels: { '/mode/distance': 'Distance', '/mode/angle': 'Angle' },
    options: [{ pointer: '/propagate', label: 'Propagate', values: BOOLS }],
    exprFields: (f) =>
      f.mode.kind === 'distance'
        ? [{ pointer: '/mode/distance', expected: 'length' }]
        : [
            { pointer: '/mode/distance', expected: 'length' },
            { pointer: '/mode/angle', expected: 'angle' },
          ],
    refs: (f) => [...f.edges],
  },
  boolean: {
    type: 'boolean',
    label: 'Boolean',
    isReference: false,
    valueLabels: {},
    options: [
      { pointer: '/op', label: 'Operation', values: ['add', 'cut', 'intersect'] },
      { pointer: '/keepTools', label: 'Keep tools', values: BOOLS },
    ],
    exprFields: () => [],
    refs: (f) => [f.target, ...f.tools],
  },
  pushPull: {
    type: 'pushPull',
    label: 'Push/Pull',
    isReference: false,
    valueLabels: { '/distance': 'Distance' },
    options: [],
    exprFields: () => [{ pointer: '/distance', expected: 'length' }],
    refs: (f) => [...f.faces],
  },
  plane: {
    type: 'plane',
    label: 'Plane',
    isReference: true,
    valueLabels: {
      '/definition/distance': 'Distance',
      '/definition/angle': 'Angle',
      '/definition/at/t': 'Position',
    },
    options: [],
    exprFields: (f) => {
      const d = f.definition;
      if (d.kind === 'offset') return [{ pointer: '/definition/distance', expected: 'length' }];
      if (d.kind === 'angle') return [{ pointer: '/definition/angle', expected: 'angle' }];
      if (d.kind === 'normalToCurve' && 't' in d.at)
        return [{ pointer: '/definition/at/t', expected: 'scalar' }];
      return [];
    },
    refs: (f) => {
      const refs: EntityRef[] = [];
      const d = f.definition;
      if (d.kind === 'offset' || d.kind === 'throughPoint') refs.push(d.from);
      if (d.kind === 'throughPoint') refs.push(d.point);
      if (d.kind === 'threePoints') refs.push(...d.points);
      if (d.kind === 'angle') refs.push(d.from, d.axis);
      if (d.kind === 'normalToCurve') {
        refs.push(d.curve);
        if (!('t' in d.at)) refs.push(d.at);
      }
      if (d.kind === 'midplane') refs.push(d.a, d.b);
      return refs;
    },
  },
  import: {
    type: 'import',
    label: 'Import',
    isReference: false,
    valueLabels: {},
    options: [],
    exprFields: () => [],
    refs: (f) => [...scopeRefs(f.scope)],
  },
  shell: {
    type: 'shell',
    label: 'Shell',
    isReference: false,
    valueLabels: { '/thickness': 'Thickness' },
    options: [],
    exprFields: () => [{ pointer: '/thickness', expected: 'length' }],
    refs: (f) => {
      const refs: EntityRef[] = [...f.openFaces];
      if (f.body) refs.push(f.body);
      return refs;
    },
  },
  draft: {
    type: 'draft',
    label: 'Draft',
    isReference: false,
    valueLabels: { '/angle': 'Angle' },
    options: [],
    exprFields: () => [{ pointer: '/angle', expected: 'angle' }],
    refs: (f) => [...f.faces, f.neutral],
  },
  sweep: {
    type: 'sweep',
    label: 'Sweep',
    isReference: false,
    valueLabels: {},
    options: [],
    exprFields: () => [],
    refs: (f) => [...f.profile, ...f.path, ...scopeRefs(f.scope)],
  },
  loft: {
    type: 'loft',
    label: 'Loft',
    isReference: false,
    valueLabels: {},
    options: [],
    exprFields: () => [],
    refs: (f) => [...f.sections, ...(f.guides ?? []), ...scopeRefs(f.scope)],
  },
  mirror: {
    type: 'mirror',
    label: 'Mirror',
    isReference: false,
    valueLabels: {},
    options: [],
    exprFields: () => [],
    refs: (f) => [...(f.source.kind === 'bodies' ? f.source.bodies : []), f.plane],
  },
  linearPattern: {
    type: 'linearPattern',
    label: 'Linear pattern',
    isReference: false,
    valueLabels: {
      '/count': 'Count',
      '/spacing': 'Spacing',
      '/second/count': 'Second count',
      '/second/spacing': 'Second spacing',
    },
    options: [],
    exprFields: (f) => {
      const out: ExprField[] = [
        { pointer: '/count', expected: 'scalar' },
        { pointer: '/spacing', expected: 'length' },
      ];
      if (f.second)
        out.push(
          { pointer: '/second/count', expected: 'scalar' },
          { pointer: '/second/spacing', expected: 'length' },
        );
      return out;
    },
    refs: (f) => {
      const refs: EntityRef[] = f.source.kind === 'bodies' ? [...f.source.bodies] : [];
      refs.push(f.direction);
      if (f.second) refs.push(f.second.direction);
      return refs;
    },
  },
  circularPattern: {
    type: 'circularPattern',
    label: 'Circular pattern',
    isReference: false,
    valueLabels: { '/count': 'Count', '/angle': 'Angle' },
    options: [],
    exprFields: () => [
      { pointer: '/count', expected: 'scalar' },
      { pointer: '/angle', expected: 'angle' },
    ],
    refs: (f) => [...(f.source.kind === 'bodies' ? f.source.bodies : []), f.axis],
  },
  hole: {
    type: 'hole',
    label: 'Hole',
    isReference: false,
    valueLabels: {
      '/diameter': 'Diameter',
      '/end/depth': 'Depth',
      '/tipAngle': 'Tip angle',
      '/counterbore/diameter': 'Counterbore diameter',
      '/counterbore/depth': 'Counterbore depth',
      '/countersink/diameter': 'Countersink diameter',
      '/countersink/angle': 'Countersink angle',
      '/thread/depth': 'Thread depth',
    },
    options: [
      { pointer: '/size', label: 'Size', values: holeSizes },
      {
        pointer: '/kind',
        label: 'Type',
        values: ['simple', 'counterbore', 'countersink', 'tapped'],
      },
      { pointer: '/fit', label: 'Fit', values: ['close', 'normal', 'loose'] },
      { pointer: '/end/kind', label: 'End type', values: END_KINDS },
    ],
    exprFields: (f) => {
      const out: ExprField[] = [];
      if (f.diameter !== undefined) out.push({ pointer: '/diameter', expected: 'length' });
      if (f.end.kind === 'blind') out.push({ pointer: '/end/depth', expected: 'length' });
      if (f.tipAngle !== undefined) out.push({ pointer: '/tipAngle', expected: 'angle' });
      if (f.counterbore?.diameter !== undefined)
        out.push({ pointer: '/counterbore/diameter', expected: 'length' });
      if (f.counterbore?.depth !== undefined)
        out.push({ pointer: '/counterbore/depth', expected: 'length' });
      if (f.countersink?.diameter !== undefined)
        out.push({ pointer: '/countersink/diameter', expected: 'length' });
      if (f.countersink?.angle !== undefined)
        out.push({ pointer: '/countersink/angle', expected: 'angle' });
      if (f.thread?.depth !== undefined) out.push({ pointer: '/thread/depth', expected: 'length' });
      return out;
    },
    refs: (f) => {
      const refs: EntityRef[] = [...f.points, f.face];
      if (f.end.kind === 'upTo') refs.push(f.end.target);
      return refs;
    },
  },
  thread: {
    type: 'thread',
    label: 'Cosmetic thread',
    isReference: false,
    valueLabels: { '/length': 'Length' },
    options: [{ pointer: '/size', label: 'Size', values: holeSizes }],
    exprFields: (f) => (f.length !== undefined ? [{ pointer: '/length', expected: 'length' }] : []),
    refs: (f) => [f.face],
  },
  axis: {
    type: 'axis',
    label: 'Axis',
    isReference: true,
    valueLabels: {},
    options: [],
    exprFields: () => [],
    refs: (f) => {
      const refs: EntityRef[] = [];
      const d = f.definition;
      if (d.kind === 'twoPoints' || d.kind === 'twoPlanes') refs.push(d.a, d.b);
      if (d.kind === 'edge') refs.push(d.edge);
      if (d.kind === 'cylinder') refs.push(d.face);
      if (d.kind === 'pointNormal') refs.push(d.point, d.plane);
      return refs;
    },
  },
  point: {
    type: 'point',
    label: 'Point',
    isReference: true,
    valueLabels: {
      '/definition/x': 'X',
      '/definition/y': 'Y',
      '/definition/z': 'Z',
      '/definition/t': 'Position',
    },
    options: [],
    exprFields: (f) => {
      const d = f.definition;
      if (d.kind === 'coordinates')
        return ['x', 'y', 'z'].map((k) => ({
          pointer: `/definition/${k}`,
          expected: 'length' as const,
        }));
      if (d.kind === 'alongEdge') return [{ pointer: '/definition/t', expected: 'scalar' }];
      return [];
    },
    refs: (f) => {
      const refs: EntityRef[] = [];
      const d = f.definition;
      if (d.kind === 'vertex') refs.push(d.vertex);
      if (d.kind === 'center') refs.push(d.of);
      if (d.kind === 'alongEdge') refs.push(d.edge);
      if (d.kind === 'intersection') refs.push(d.a, d.b);
      return refs;
    },
  },
};

/** The definition of a feature's kind, typed for the union (the mapped type cannot correlate). */
export function featureDef(f: { type: FeatureType }): FeatureDef<FeatureType> {
  return FEATURE_DEFS[f.type] as FeatureDef<FeatureType>;
}

/** Reference geometry (plane, axis, point), by type string. */
export function isReferenceType(type: string): boolean {
  return Object.hasOwn(FEATURE_DEFS, type) && FEATURE_DEFS[type as FeatureType].isReference;
}

/** The label of a feature value (`/end/depth` of an extrude: `Depth`); the last segment when unknown. */
export function fieldLabel(type: FeatureType, pointer: string): string {
  const known = FEATURE_DEFS[type].valueLabels[pointer];
  if (known) return known;
  const last = pointer.split('/').pop() ?? pointer;
  return last.charAt(0).toUpperCase() + last.slice(1);
}
