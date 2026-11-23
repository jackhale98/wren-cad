/**
 * Constraints that link separate shapes (ADR-087 amendment, 2026-11-23). Owner: "Having them add
 * constraints is fine as long as it's obvious that it's adding them and that we can easily remove
 * them." Pure: what a click's notice says, and where a link's glyphs sit (one at each shape).
 */

import type { Id, SketchConstraint } from '@wren-cad/contracts';
import {
  type ConnectedPieces,
  constraintLabel,
  constraintRefs,
  crossPieceLinks,
  Namer,
  type SketchGeometry,
} from '@wren-cad/sketch';

export interface LinkNotice {
  /** Plain words: "Kept level with another shape". */
  text: string;
  /** The constraints the notice's Remove deletes. */
  ids: Id[];
}

const PHRASE: Partial<Record<SketchConstraint['kind'], string>> = {
  horizontalPoints: 'kept level with',
  verticalPoints: 'kept in line vertically with',
  parallel: 'kept parallel to',
  perpendicular: 'kept perpendicular to',
  equal: 'kept equal to',
  concentric: 'kept concentric with',
};

/**
 * The notice for constraints `added` by one edit that link the new geometry to another shape
 * (`sketch` already contains the edit); null when they link nothing.
 */
export function linkNotice(
  sketch: SketchGeometry,
  added: readonly SketchConstraint[],
): LinkNotice | null {
  const links = crossPieceLinks(sketch, added);
  if (links.length === 0) return null;
  // Short and without entity numbers ("Point 3" means nothing to the person drawing): the
  // highlighted glyphs show where the links are. Each kind is said once.
  const namer = new Namer(sketch.entities);
  const phrases = [
    ...new Set(links.map((c) => PHRASE[c.kind] ?? constraintLabel(c, namer, {}).toLowerCase())),
  ];
  const first = phrases[0] as string;
  const text =
    phrases.length === 1
      ? `${first[0]?.toUpperCase()}${first.slice(1)} another shape`
      : `Linked to another shape: ${phrases.map((x) => x.replace(/ (with|to)$/, '')).join(', ')}`;
  return { text, ids: links.map((c) => c.id) };
}

/**
 * The entities a link's glyph is shown on: one per shape it links (the first entity it names in
 * each), so the glyph is visible at both ends. Empty for constraints that link nothing.
 */
export function linkHosts(pieces: ConnectedPieces, c: SketchConstraint): Id[] {
  if ('value' in c || !pieces.links(c)) return [];
  const seen = new Set<Id>();
  const out: Id[] = [];
  for (const id of constraintRefs(c)) {
    if (pieces.anchored(id)) continue;
    const p = pieces.piece(id);
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(id);
  }
  return out;
}
