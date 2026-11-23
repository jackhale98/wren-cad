/**
 * M5 (ADR-100): STEP AP242 model dimensions and tolerances (PMI). Lead-owned contract.
 *
 * Export: the worker resolves each part annotation's `EntityRef`s against the latest regen and
 * hands the kernel façade a neutral, index-based description (`PmiExportItem`); the façade builds
 * an XCAF document (`XCAFDoc_DimTolTool`: dimensions, geometric tolerances, datums) on the exact
 * sub-shapes and writes AP242 with `STEPCAFControl_Writer`. Presentation PMI (tessellated lines
 * and stroked text from the M4 layout code) is attached so presentation-only viewers show the
 * annotations too. An annotation that needs attention is never exported; the report says so.
 *
 * Import: the façade reads semantic PMI with `STEPCAFControl_Reader` into `PmiImportItem`s on the
 * imported body's sub-shape indices; the app turns them into part annotations on the import
 * feature's face names. What OCCT cannot read is reported per item, never dropped silently.
 *
 * v2 (ADR-101, additive: every v2 field is optional and a v1 reader ignores it): the measurement
 * direction and points of a dimension, basic and reference dimensions, ordinates, spherical sizes
 * and zones, zone modifiers, projected and unequal zones, all around, filled presentation areas,
 * and a code and severity on each import issue so a report can group and rank them. The façade
 * writes what OCCT's XCAF objects can hold and reports the rest as a note; it never drops a field
 * silently.
 */

import type { RefPoint, ZoneModifier } from './annotation';
import type { Id, Vec3 } from './document';

/** CAx-IF / XCAFDimTolObjects type names, kept as strings so the façade maps 1:1. */
export type PmiDimensionType =
  | 'linearDistance'
  | 'linearDiameter'
  | 'linearRadius'
  | 'angular'
  | 'size'
  | 'curveLength'
  | 'other';

export type PmiToleranceType =
  | 'straightness'
  | 'flatness'
  | 'circularity'
  | 'cylindricity'
  | 'profileOfLine'
  | 'profileOfSurface'
  | 'parallelism'
  | 'perpendicularity'
  | 'angularity'
  | 'position'
  | 'concentricity'
  | 'coaxiality'
  | 'symmetry'
  | 'circularRunout'
  | 'totalRunout';

/** A sub-shape of one exported/imported body, by its topological index (TopExp map order, 1-based). */
export interface PmiTarget {
  /** 0-based index into the exported/returned bodies. */
  body: number;
  kind: 'face' | 'edge' | 'vertex';
  index: number;
}

/** Presentation PMI: polylines (part coordinates, mm) of the annotation as drawn, text stroked. */
export interface PmiPresentation {
  /** Annotation plane: origin, x, normal. */
  plane: { origin: Vec3; x: Vec3; normal: Vec3 };
  polylines: Vec3[][];
  /**
   * v2: filled areas (arrowheads, filled text of another system) as triangles, three points
   * each. Read on import; Wren's own export strokes text and needs none.
   */
  triangles?: Vec3[];
}

export type PmiExportItem = {
  /** The Wren annotation id, written as the PMI entity's name so round trips keep identity. */
  annotationId: Id;
  presentation?: PmiPresentation;
} & (
  | {
      kind: 'dimension';
      type: PmiDimensionType;
      targets: PmiTarget[];
      /** mm or rad, as measured. */
      value: number;
      /** Plus/minus deviations (mm or rad), or an ISO 286 fit. */
      tolerance?:
        | { kind: 'deviation'; upper: number; lower: number }
        | { kind: 'fit'; hole?: string; shaft?: string };
      /**
       * v2: unit vector (part coordinates) a linear distance is measured along. Absent: the true
       * distance between the targets (an aligned dimension).
       */
      direction?: Vec3;
      /**
       * v2: the point of each target the dimension measures, parallel to `targets`; absent or
       * shorter = `'self'`.
       */
      at?: RefPoint[];
      /** v2: theoretically exact (basic) or reference (auxiliary) dimension; neither has a tolerance. */
      qualifier?: 'basic' | 'reference';
      /**
       * v2: an ordinate: the coordinate of `targets[1]` from the origin `targets[0]` along
       * `direction`. STEP has no ordinate type: it is written as a linear distance with a
       * description another Wren reads back; any other reader sees the linear distance.
       */
      ordinate?: boolean;
      /** v2: the radius or diameter is of a sphere (SR / SØ). */
      spherical?: boolean;
    }
  | {
      kind: 'datum';
      label: string;
      targets: PmiTarget[];
    }
  | {
      kind: 'tolerance';
      type: PmiToleranceType;
      targets: PmiTarget[];
      /** Zone value, mm; `diameter` for a cylindrical zone. */
      value: number;
      diameter?: boolean;
      /** v2: with `diameter`, a spherical zone (SØ). */
      spherical?: boolean;
      /** Material modifier on the zone. */
      material?: 'M' | 'L';
      /** Datum reference frame: up to three, primary first, each with an optional modifier. */
      datums?: { label: string; material?: 'M' | 'L' }[];
      /** v2: zone modifiers, as `ToleranceZone.modifiers`. */
      modifiers?: ZoneModifier[];
      /** v2: projected tolerance zone height, mm. */
      projected?: number;
      /** v2: unequally disposed zone offset, mm. */
      unequal?: number;
      /** v2: all around / all over (profile). */
      allAround?: boolean;
    }
);

export interface PmiExportReport {
  exported: number;
  /** Not exported, with the reason (needs attention, unsupported kind, unresolved target). */
  skipped: { annotationId: Id; reason: string }[];
  /** Exported with a caveat (STEP holds one fit class per dimension, so H8/f7 writes H8). */
  notes?: { annotationId: Id; note: string }[];
}

/**
 * One item read from a STEP file. OCCT cannot tell a Wren file from another: `name` is what the
 * file holds, and `annotationId` is set only when that name carries a Wren id (ADR-100 amendment).
 */
type Imported<K> = Omit<Extract<PmiExportItem, { kind: K }>, 'annotationId'> & {
  annotationId?: Id;
  name?: string;
};
export type PmiImportItem =
  | Imported<'dimension'>
  | Imported<'datum'>
  | Imported<'tolerance'>
  | { kind: 'presentationOnly'; name?: string; presentation: PmiPresentation };

/**
 * v2: what an import issue cost. `lost`: an annotation in the file did not come in. `approximated`:
 * it came in changed (a spherical zone as a cylindrical one). `cosmetic`: every annotation came
 * in; only how one is drawn differs.
 */
export type PmiIssueSeverity = 'lost' | 'approximated' | 'cosmetic';

export interface PmiImportIssue {
  name?: string;
  reason: string;
  /**
   * v2: stable key for issues with the same cause (`datumNoGeometry`, `targetNotInBodies`,
   * `noValue`, `datumTarget`, `filledPresentation` …), so a report shows one line with a count.
   * Absent: group by `reason`.
   */
  code?: string;
  /** v2; absent = `'lost'`. */
  severity?: PmiIssueSeverity;
}

export interface PmiImportResult {
  items: PmiImportItem[];
  /** Per entity OCCT could not read (type, value or target), with what is known. */
  issues: PmiImportIssue[];
}
