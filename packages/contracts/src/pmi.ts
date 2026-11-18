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
 */

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
  body: number;
  kind: 'face' | 'edge' | 'vertex';
  index: number;
}

/** Presentation PMI: polylines (part coordinates, mm) of the annotation as drawn, text stroked. */
export interface PmiPresentation {
  /** Annotation plane: origin, x, normal. */
  plane: { origin: Vec3; x: Vec3; normal: Vec3 };
  polylines: Vec3[][];
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
      /** Material modifier on the zone. */
      material?: 'M' | 'L';
      /** Datum reference frame: up to three, primary first, each with an optional modifier. */
      datums?: { label: string; material?: 'M' | 'L' }[];
    }
);

export interface PmiExportReport {
  exported: number;
  /** Not exported, with the reason (needs attention, unsupported kind, unresolved target). */
  skipped: { annotationId: Id; reason: string }[];
}

/** One item read from a STEP file. `annotationId` is set when the file came from Wren. */
export type PmiImportItem =
  | (Extract<PmiExportItem, { kind: 'dimension' }> & { name?: string })
  | (Extract<PmiExportItem, { kind: 'datum' }> & { name?: string })
  | (Extract<PmiExportItem, { kind: 'tolerance' }> & { name?: string })
  | { kind: 'presentationOnly'; name?: string; presentation: PmiPresentation };

export interface PmiImportResult {
  items: PmiImportItem[];
  /** Per entity OCCT could not read (type, value or target), with what is known. */
  issues: { name?: string; reason: string }[];
}
