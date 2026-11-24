/**
 * Change preview (slice 2e.1, ADR-103): what a feature does to the model and which faces it made,
 * read from the feature and the persistent names already in the mesh. No kernel call.
 */

import type {
  BodyOp,
  ExtrudeFeature,
  Feature,
  FeatureEffect,
  Id,
  RegionPrismSpec,
  SketchResult,
  Vec3,
} from '@wren-cad/contracts';

const byOp = (op: BodyOp): FeatureEffect =>
  op === 'cut' ? 'cut' : op === 'intersect' ? 'modify' : 'add';

/**
 * The tint family of a feature, or null when it makes no faces worth tinting (sketches, reference
 * geometry, cosmetic threads, and mirror / patterns, whose effect depends on their sources).
 * Operations: new and add make material, cut removes it, intersect reshapes what is left.
 */
export function featureEffect(f: Feature): FeatureEffect | null {
  switch (f.type) {
    case 'primitive':
    case 'extrude':
    case 'revolve':
    case 'boolean':
    case 'import':
    case 'sweep':
    case 'loft':
      return byOp(f.op);
    case 'hole':
      return 'cut';
    case 'fillet':
    case 'chamfer':
    case 'draft':
    case 'shell':
    case 'pushPull':
      return 'modify';
    default:
      return null;
  }
}

/**
 * Slice 2e.2: the kinds whose exact added or removed solid the regen engine can return for the
 * feature being edited (`RegenRequest.preview`). The engine decides what the solid is; this only
 * keeps the app from asking, and regenerating, for kinds that have none.
 */
export function hasSolidPreview(f: Feature): boolean {
  switch (f.type) {
    case 'primitive':
    case 'extrude':
    case 'revolve':
    case 'sweep':
    case 'loft':
      return true;
    default:
      return false;
  }
}

/** True when a persistent face name was made by this feature (`F<id>:…`, outermost tag only). */
export function isOwnFace(name: string, featureId: Id): boolean {
  return name.startsWith(`F${featureId}:`);
}

/**
 * Face ordinals per body whose persistent name starts with the feature's tag. Modifying features
 * name what they make `F<id>:fillet(F<earlier>:edge(…))`, `F<id>:chamfer(…)`, tool faces
 * `F<id>:face(…)`; a face that merely survives keeps its earlier feature's name and is not owned.
 */
export function ownedFaces(
  bodies: ReadonlyArray<{ id: string; mesh: { faceNames: readonly string[] } }>,
  featureId: Id,
): Array<{ bodyId: string; faces: number[] }> {
  const out: Array<{ bodyId: string; faces: number[] }> = [];
  for (const b of bodies) {
    const faces: number[] = [];
    b.mesh.faceNames.forEach((n, i) => {
      if (isOwnFace(n, featureId)) faces.push(i);
    });
    if (faces.length > 0) out.push({ bodyId: b.id, faces });
  }
  return out;
}

/**
 * The volume a blind extrude sweeps, exactly, from its sketch regions and the evaluated depth.
 * `null` (show nothing) wherever it would not be exact: ends other than blind, a draft angle,
 * intersect or unknown profile regions, mixed sketch planes, or a depth that is not positive.
 * Normal sweeps along the sketch normal, reverse against it, symmetric spans half the depth each
 * way (the kernel centres the prism, `whittle_modeling.cpp` extrude).
 */
export function extrudePrism(
  f: ExtrudeFeature,
  sketches: readonly SketchResult[],
  depthMm: number | null,
  drafted: boolean,
): RegionPrismSpec | null {
  if (f.end.kind !== 'blind' || drafted) return null;
  if (f.op === 'intersect') return null;
  if (depthMm === null || !Number.isFinite(depthMm) || !(depthMm > 1e-6)) return null;
  if (f.profile.length === 0) return null;
  const regions = [];
  let normal: Vec3 | null = null;
  for (const p of f.profile) {
    let found = false;
    for (const s of sketches) {
      const r = s.regions.find((x) => x.name === p.name);
      if (!r) continue;
      if (
        normal &&
        (s.frame.z[0] !== normal[0] || s.frame.z[1] !== normal[1] || s.frame.z[2] !== normal[2])
      )
        return null;
      normal = s.frame.z;
      regions.push(r.mesh);
      found = true;
      break;
    }
    if (!found) return null;
  }
  if (!normal) return null;
  const sign = f.direction === 'reverse' ? -1 : 1;
  return {
    regions,
    direction: [normal[0] * sign || 0, normal[1] * sign || 0, normal[2] * sign || 0], // no -0
    distance: depthMm,
    ...(f.direction === 'symmetric' ? { offset: -depthMm / 2 } : {}),
    effect: f.op === 'cut' ? 'cut' : 'add',
  };
}
