/**
 * Connected pieces of sketch geometry (ADR-087 amendment, 2026-11-23). Owner: inferred
 * constraints between separate shapes are fine "as long as it's obvious that it's adding them
 * and that we can easily remove them". This module finds them:
 *
 * - A *piece* is the entities linked through shared points and the touching constraints
 *   (`coincident`, `pointOn`, `tangent`, `midpoint`), transitively.
 * - A *link* is any other constraint or dimension whose entities lie in two or more pieces: it
 *   makes a drag of one piece move the other. {@link crossPieceLinks} lists the links an edit adds
 *   (the app announces them with a Remove action); {@link PieceLinks} finds the links that carry a
 *   drag from the dragged piece to a piece that moved (the app highlights their glyphs).
 * - The origin, the axes, `fix`ed geometry and linked (projected) geometry belong to no piece:
 *   they can't be dragged along, so a relation to them links nothing.
 *
 * Pure.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Id, SketchConstraint, SketchEntity } from '@wren-cad/contracts';
import { constraintRefs, isSketchReference, SKETCH_ORIGIN } from './references';

/** Touching constraints and the two fields they join. */
const TOUCHING: Readonly<Record<string, readonly [string, string]>> = {
  coincident: ['a', 'b'],
  pointOn: ['point', 'on'],
  tangent: ['a', 'b'],
  midpoint: ['point', 'line'],
};

/** True for the constraints that make geometry touch (they join pieces, never link them). */
export function isTouching(c: { kind: string }): boolean {
  return c.kind in TOUCHING;
}

/** The points an entity is built on (shared points connect entities). */
export function entityPoints(e: SketchEntity): Id[] {
  switch (e.kind) {
    case 'point':
      return [];
    case 'line':
      return [e.start, e.end];
    case 'circle':
    case 'ellipse':
      return [e.center];
    case 'arc':
    case 'ellipticArc':
      return [e.center, e.start, e.end];
    case 'bspline':
      return [...e.poles, ...(e.through ?? [])];
  }
}

const str = (c: object, k: string): Id | null => {
  const v = (c as Record<string, unknown>)[k];
  return typeof v === 'string' ? v : null;
};

export interface SketchGeometry {
  entities: readonly SketchEntity[];
  constraints: readonly SketchConstraint[];
}

export class ConnectedPieces {
  private readonly parent = new Map<Id, Id>();
  private readonly fixed = new Set<Id>();
  private readonly points = new Map<Id, readonly Id[]>();

  constructor(entities: readonly SketchEntity[], constraints: readonly SketchConstraint[] = []) {
    // What cannot move is found first: nothing is joined through it below.
    for (const e of entities) {
      const pts = entityPoints(e);
      this.points.set(e.id, pts);
      if (e.source) for (const id of [e.id, ...pts]) this.fixed.add(id);
    }
    for (const c of constraints) {
      if (c.kind === 'fix') {
        for (const x of [c.entity, ...(this.points.get(c.entity) ?? [])]) this.fixed.add(x);
      } else if (c.kind === 'coincident') {
        if (c.a === SKETCH_ORIGIN) this.fixed.add(c.b);
        if (c.b === SKETCH_ORIGIN) this.fixed.add(c.a);
      }
    }
    // An entity and its own points are one piece (also a fixed one, with itself).
    for (const [id, pts] of this.points) for (const p of pts) this.union(id, p);
    for (const c of constraints) {
      if (c.kind === 'fix') continue;
      const fields = TOUCHING[c.kind];
      const a = fields ? str(c, fields[0]) : null;
      const b = fields ? str(c, fields[1]) : null;
      if (a && b) this.join(a, b);
    }
  }

  /** The piece's representative id. */
  piece(id: Id): Id {
    let r = id;
    while (this.parent.has(r) && this.parent.get(r) !== r) r = this.parent.get(r) as Id;
    let c = id;
    while (c !== r) {
      const next = this.parent.get(c) as Id;
      this.parent.set(c, r);
      c = next;
    }
    return r;
  }

  /**
   * Touching geometry is one piece, except through what cannot move: the origin and axes, `fix`ed
   * and projected geometry. Two shapes that each touch the same axis or the same projected edge
   * stay separate pieces, so a relation between them is still a link (announced, shown).
   */
  private join(a: Id, b: Id): void {
    if (this.anchored(a) || this.anchored(b)) return;
    this.union(a, b);
  }

  private union(a: Id, b: Id): void {
    const ra = this.piece(a);
    const rb = this.piece(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  same(a: Id, b: Id): boolean {
    return this.piece(a) === this.piece(b);
  }

  /**
   * The origin, an axis, `fix`ed or linked geometry, or a point coincident with the origin: it
   * can't be dragged, so a relation to it links nothing. A curve is fixed when all its points are.
   */
  anchored(id: Id): boolean {
    if (isSketchReference(id) || this.fixed.has(id)) return true;
    const pts = this.points.get(id);
    return !!pts && pts.length > 0 && pts.every((p) => this.fixed.has(p));
  }

  /** The pieces a constraint relates (anchored geometry left out); empty for touching ones. */
  piecesOf(c: SketchConstraint): Id[] {
    if (isTouching(c)) return [];
    const out = new Set<Id>();
    for (const id of constraintRefs(c)) if (!this.anchored(id)) out.add(this.piece(id));
    return [...out];
  }

  /** True when `c` links two or more pieces. */
  links(c: SketchConstraint): boolean {
    return this.piecesOf(c).length > 1;
  }
}

/**
 * The constraints of `added` that link different pieces of `sketch` (which already contains
 * them: an edit's own touching constraints join its geometry to what it touches first).
 */
export function crossPieceLinks(
  sketch: SketchGeometry,
  added: readonly SketchConstraint[],
): SketchConstraint[] {
  const pieces = new ConnectedPieces(sketch.entities, sketch.constraints);
  return added.filter((c) => pieces.links(c));
}

/**
 * The graph of pieces and the links between them, built once per drag: {@link carriers} names the
 * links on the path from the dragged entity's piece to each piece that moved.
 */
export class PieceLinks {
  readonly pieces: ConnectedPieces;
  private readonly edges = new Map<Id, { link: Id; to: Id }[]>();

  constructor(sketch: SketchGeometry) {
    this.pieces = new ConnectedPieces(sketch.entities, sketch.constraints);
    for (const c of sketch.constraints) {
      const ps = this.pieces.piecesOf(c);
      if (ps.length < 2) continue;
      for (const a of ps)
        for (const b of ps) {
          if (a === b) continue;
          const list = this.edges.get(a) ?? [];
          list.push({ link: c.id, to: b });
          this.edges.set(a, list);
        }
    }
  }

  /** True when no constraint links two pieces (nothing can carry a drag across). */
  get empty(): boolean {
    return this.edges.size === 0;
  }

  /**
   * Link constraint ids on a shortest path from `dragged`'s piece to the piece of each of `moved`
   * (entities of other pieces that moved). Empty when nothing of another piece moved.
   */
  carriers(dragged: Id, moved: Iterable<Id>): Id[] {
    const start = this.pieces.piece(dragged);
    const targets = new Set<Id>();
    for (const id of moved) {
      const p = this.pieces.piece(id);
      if (p !== start) targets.add(p);
    }
    if (targets.size === 0) return [];
    const via = new Map<Id, { link: Id; from: Id } | null>([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const p = queue.shift() as Id;
      for (const e of this.edges.get(p) ?? [])
        if (!via.has(e.to)) {
          via.set(e.to, { link: e.link, from: p });
          queue.push(e.to);
        }
    }
    const out = new Set<Id>();
    for (const t of targets) {
      for (let step = via.get(t); step; step = via.get(step.from)) out.add(step.link);
    }
    return [...out];
  }
}
