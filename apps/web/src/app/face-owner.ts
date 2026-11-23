/**
 * The feature that made a face, and the sketch that feature was made from (owner, 2026-11-23:
 * a right click on a surface offers "Edit feature" and "Edit sketch"). Read from persistent
 * names only: no kernel call, and never a guess (no name, no owner).
 */

import type { Id, PickHit } from '@wren-cad/contracts';
import { consumedSketchRefs } from '../features/factories';
import type { Workbench } from './workbench';

export interface FaceOwner {
  featureId: Id;
  /** The sketch the feature consumed (its first profile, path or point reference), if any. */
  sketchId: Id | null;
}

/** The sketch id in a persistent sketch name (`S<id>:e(…)`), or null. */
export function sketchIdOfName(name: string): Id | null {
  const m = /^S([^:]+):/.exec(name);
  return m ? (m[1] as Id) : null;
}

export function faceOwner(wb: Workbench, hit: PickHit | undefined): FaceOwner | null {
  const part = wb.part;
  if (!part || !hit || hit.kind !== 'face') return null;
  // The latest feature named in the face's persistent name (as mirror and pattern sources).
  const featureId = wb.ownerFeature(hit, '' as Id);
  const f = featureId ? part.features.find((x) => x.id === featureId) : undefined;
  if (!f) return null;
  let sketchId: Id | null = null;
  for (const ref of consumedSketchRefs(f)) {
    const id = sketchIdOfName(ref.name);
    if (id && part.features.some((x) => x.id === id && x.type === 'sketch')) {
      sketchId = id;
      break;
    }
  }
  return { featureId: f.id, sketchId };
}

/** The single selected face's owner; null for any other selection. */
export function selectedFaceOwner(wb: Workbench): FaceOwner | null {
  const sel = wb.ui.get().selection;
  return sel.length === 1 ? faceOwner(wb, sel[0]?.hit) : null;
}
