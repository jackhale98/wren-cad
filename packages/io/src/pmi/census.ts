// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * M5a (ADR-100): a quick count of the PMI entities in a STEP file's text, without the kernel. The
 * import report uses it to say "this file has PMI that this kernel build cannot read" instead of
 * saying nothing, and to cross-check what the reader returned. Counts entity instances by type
 * name (simple and complex instances alike), so they are counts of STEP entities, not of drawn
 * annotations; good enough to tell "none" from "some" and to compare files.
 */

export interface StepPmiCensus {
  /** The file's schema names (`FILE_SCHEMA`), e.g. `AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF`. */
  schemas: string[];
  /** `dimensional_size` / `dimensional_location` (and angular) entities. */
  dimensions: number;
  /** Geometric tolerances by type (flatness, position …). */
  tolerances: number;
  /** `datum` entities (datum features excluded). */
  datums: number;
  /** Presentation: draughting callouts and annotation occurrences (graphic PMI). */
  presentation: number;
}

const DIMENSIONS =
  /\b(?:DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION|ANGULAR_SIZE|ANGULAR_LOCATION)\s*\(/g;
const TOLERANCES =
  /\b(?:ANGULARITY|CIRCULAR_RUNOUT|COAXIALITY|CONCENTRICITY|CYLINDRICITY|FLATNESS|LINE_PROFILE|PARALLELISM|PERPENDICULARITY|POSITION|ROUNDNESS|STRAIGHTNESS|SURFACE_PROFILE|SYMMETRY|TOTAL_RUNOUT)_TOLERANCE\s*\(/g;
const DATUMS = /(?:^|[=\s(])DATUM\s*\(/gm;
const PRESENTATION =
  /\b(?:DRAUGHTING_CALLOUT|TESSELLATED_ANNOTATION_OCCURRENCE|ANNOTATION_CURVE_OCCURRENCE|ANNOTATION_FILL_AREA_OCCURRENCE|ANNOTATION_PLACEHOLDER_OCCURRENCE)\s*\(/g;

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

/** Counts PMI entities in STEP Part 21 bytes (ASCII; anything else counts nothing). */
export function stepPmiCensus(bytes: Uint8Array): StepPmiCensus {
  const text = new TextDecoder('latin1').decode(bytes);
  const header = /FILE_SCHEMA\s*\(\s*\(([^)]*)\)/i.exec(text);
  const schemas = header
    ? [...(header[1] as string).matchAll(/'([^']*)'/g)].map((m) => (m[1] as string).trim())
    : [];
  const data = text.slice(Math.max(0, text.search(/\bDATA\s*;/)));
  return {
    schemas,
    dimensions: count(data, DIMENSIONS),
    tolerances: count(data, TOLERANCES),
    datums: count(data, DATUMS),
    presentation: count(data, PRESENTATION),
  };
}

/** Does the census find any PMI (semantic or presentation)? */
export function hasStepPmi(c: StepPmiCensus): boolean {
  return c.dimensions + c.tolerances + c.datums + c.presentation > 0;
}
