/**
 * Drag handles of a selected leader (ADR-094): its attach point, its bends, and a handle that
 * adds a bend. Each drag is a preview (`previewDrag`): nothing is stored or built until release,
 * which is one edit (one undo step); Escape or a cancel leaves nothing behind.
 *
 * Snapping: the attach point stays on the line it is attached to. On a surface's line it slides
 * along the line and onto its extension past either end (snapping to the ends and the middle;
 * `storableAttachT` bounds it to what the document stores); on a size dimension it takes the
 * nearer end of the dimension line, so it stays in line with it, but never the end the
 * dimension's own text is beyond (`dimensionTextEnd`).
 *
 * Every drag starts from the layout as drawn (`drawnLeaderLayout`), which differs from the stored
 * one only when the layout moved a datum off a dimension's text end.
 */

import type { AnnotationPlacement, Id, PlacementLayout, Vec2 } from '@wren-cad/contracts';
import {
  dimensionLineEnd,
  dimensionTextEnd,
  flipDimensionLineEnd,
  lineParameter,
  type PlacedAnnotation,
  storableAttachT,
} from '@wren-cad/drawing';
import { type SvgNode, svgItems } from '@wren-cad/drawing/svg';
import type { SheetDrag, SheetPointer } from '@wren-cad/ui/drawing';
import type { DrawingController } from './controller';
import { updatePlacement } from './ops-annot';
import { ACCENT, grip } from './overlay-nodes';
import type { Built } from './pipeline';
import { followersOf, PREVIEW_NODE, placementPreview, previewDrag } from './preview-drag';

type Leader = Extract<PlacementLayout, { kind: 'leader' }>;

export type LeaderHandle =
  | { kind: 'attach'; at: Vec2 }
  | { kind: 'bend'; index: number; at: Vec2 }
  /** Drag it to add a bend in the middle of the last leg. */
  | { kind: 'addBend'; at: Vec2 };

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A leader placement's layout as it is drawn: the layout's own (`PlacedAnnotation.leader.layout`)
 * when it moved a datum off a dimension's text end, else the stored one. Drags, arrow keys and the
 * inspector edit this one, so what moves is what is on the sheet.
 */
export function drawnLeaderLayout<T extends PlacementLayout>(
  layout: T,
  placed: PlacedAnnotation | undefined,
): T | Leader {
  return layout.kind === 'leader' && placed?.leader?.layout ? placed.leader.layout : layout;
}

/** The end of the dimension line a leader on it cannot take (the dimension's text is there). */
export function takenEnd(b: Built, layout: PlacementLayout): 0 | 1 | null {
  if (layout.kind !== 'leader' || layout.attach.kind !== 'dimensionLine') return null;
  const id = layout.attach.placementId;
  const dim = b.build.placed.find((x) => x.placementId === id);
  return dim?.line ? dimensionTextEnd(dim.line, dim.textBox) : null;
}

function placedOf(
  b: Built,
  placementId: Id,
): { pl: AnnotationPlacement; placed: PlacedAnnotation } | null {
  const pl = b.drawing.placements.find((x) => x.id === placementId);
  const placed = b.build.placed.find((x) => x.placementId === placementId);
  return pl && placed?.leader && pl.layout.kind === 'leader' ? { pl, placed } : null;
}

/** The handles of a selected leader placement, sheet mm. */
export function leaderHandlesOf(b: Built, placementId: Id): LeaderHandle[] {
  const g = placedOf(b, placementId)?.placed.leader;
  return g ? handlesOfLeader(g) : [];
}

/**
 * Snaps `t` on a surface line to its ends and middle within `snap` sheet mm. Outside [0, 1] it is
 * on the line's extension, bounded by what the document stores (`storableAttachT`).
 */
export function snapAlong(t: number, length: number, snap: number): number {
  for (const s of [0, 0.5, 1]) if (Math.abs(t - s) * length <= snap) return s;
  return Math.round(storableAttachT(t) * 1e4) / 1e4;
}

/**
 * The layout after dragging the attach point to `p`. On a surface's line: along it (and its
 * extension). On a dimension line: the nearer end, unless the dimension's text is there (`taken`);
 * flipping ends mirrors the text along the line, so the datum keeps pointing out of the
 * dimension. Exported for tests.
 */
export function dragAttach(
  layout: Leader,
  on: [Vec2, Vec2],
  p: Vec2,
  snap: number,
  taken: 0 | 1 | null = null,
): Leader {
  const t = lineParameter(on, p);
  const a = layout.attach;
  if (a.kind === 'ref') {
    const next = snapAlong(t, len(sub(on[1], on[0])), snap);
    return {
      ...layout,
      attach: next === 0.5 ? { kind: 'ref', index: a.index } : { ...a, t: next },
    };
  }
  if (a.kind === 'dimensionLine') {
    const end = dimensionLineEnd(t);
    if (end === dimensionLineEnd(a.t) || end === taken) return layout;
    return flipDimensionLineEnd(layout, on);
  }
  return layout;
}

/** The handles of a laid-out leader (sheet mm), for the stored state and for a drag's preview. */
function handlesOfLeader(g: NonNullable<PlacedAnnotation['leader']>): LeaderHandle[] {
  if (g.attach === 'placement') return [];
  const out: LeaderHandle[] = [];
  if (g.on) out.push({ kind: 'attach', at: g.at });
  g.bends.forEach((at, index) => {
    out.push({ kind: 'bend', index, at });
  });
  // The last leg as drawn (after the corner a held leader turns at), else from the last bend.
  const last = (g.path && g.path.length >= 2 ? g.path.at(-2) : undefined) ?? g.bends.at(-1) ?? g.at;
  if (len(sub(g.text, last)) > 6)
    out.push({ kind: 'addBend', at: [(last[0] + g.text[0]) / 2, (last[1] + g.text[1]) / 2] });
  return out;
}

/** The handles drawn by the preview (the React overlay's are hidden while a drag stands in). */
export function handleNodes(g: PlacedAnnotation['leader'], mm: number): SvgNode[] {
  if (!g) return [];
  const out: SvgNode[] = [];
  if (g.on)
    out.push({
      tag: 'line',
      attrs: {
        x1: String(g.on[0][0]),
        y1: String(g.on[0][1]),
        x2: String(g.on[1][0]),
        y2: String(g.on[1][1]),
        stroke: ACCENT,
        'stroke-width': String(1.2 * mm),
        'stroke-dasharray': `${4 * mm} ${3 * mm}`,
        'data-leader-guide': 'line',
      },
    });
  for (const h of handlesOfLeader(g))
    out.push(grip(h.at, mm, h.kind === 'addBend' ? 3.5 : 4.5, { 'data-leader-handle': h.kind }));
  return out;
}

/**
 * A drag of one of the selected leader's handles under the pointer, or null. A preview (ADR-094):
 * the leader is laid out again per frame (`placementPreview`, with the leaders attached to it)
 * and drawn over the sheet; nothing is stored until release, which is one `updatePlacement` (one
 * undo step); Escape or a cancel leaves nothing behind.
 */
export function leaderHandleDrag(
  c: DrawingController,
  placementId: Id,
  p: SheetPointer,
): SheetDrag | null {
  const b = c.built();
  if (!b || c.ui.get().tool !== 'select') return null;
  const reach = 9 * p.mm;
  const handle = leaderHandlesOf(b, placementId)
    .map((h) => ({ h, d: len(sub(p.at, h.at)) }))
    .filter((x) => x.d <= reach)
    .sort((x, y) => x.d - y.d)[0]?.h;
  const found = placedOf(b, placementId);
  if (!handle || !found?.placed.leader) return null;
  const g = found.placed.leader;
  const pl = found.pl;
  const start = drawnLeaderLayout(pl.layout, found.placed) as Leader;
  const taken = takenEnd(b, start);
  const key = `drag:leader:${placementId}:${handle.kind}${handle.kind === 'bend' ? handle.index : ''}`;
  const rel = (q: Vec2): Vec2 => [round3(q[0] - g.at[0]), round3(q[1] - g.at[1])];
  const layoutAt = (q: Vec2, mm: number): Leader => {
    if (handle.kind === 'attach' && g.on) return dragAttach(start, g.on, q, 6 * mm, taken);
    if (handle.kind === 'bend') {
      const bends = [...(start.bends ?? [])];
      bends[handle.index] = rel(q);
      return { ...start, bends };
    }
    if (handle.kind === 'addBend') return { ...start, bends: [...(start.bends ?? []), rel(q)] };
    return start;
  };
  const hide = [
    ...[placementId, ...followersOf(b, placementId).map((f) => f.id)].map(
      (id) => `placement:${id}`,
    ),
    `overlay:leader:${placementId}`,
  ];
  return previewDrag(c, { hide }, (q) => {
    const layout = layoutAt(q.at, q.mm);
    const next: AnnotationPlacement = { ...pl, layout };
    const pv = placementPreview(b, next);
    if (!pv) return null;
    const same = JSON.stringify(layout) === JSON.stringify(start);
    return {
      frame: {
        nodes: [PREVIEW_NODE(svgItems(pv.items, b.drawing.style))],
        overlay: handleNodes(pv.placed.leader, q.mm),
      },
      commit: same
        ? null
        : () => {
            const cur = c.drawing()?.placements.find((x) => x.id === placementId);
            if (cur?.layout.kind !== 'leader') return;
            updatePlacement(
              c,
              { ...cur, layout },
              handle.kind === 'addBend' ? 'Bend leader' : 'Move leader',
              key,
            );
          },
    };
  });
}

/**
 * A leader placement edited in the inspector, made consistent with the drag rules: a datum
 * switched to the other end of its dimension line keeps pointing out of the dimension (the text
 * and bends mirrored along the line, as a drag does), and the end the dimension's text is beyond
 * is refused (null). `shown` is the placement as drawn (`drawnLeaderLayout`). Exported for tests.
 */
export function inspectorLeaderEdit(
  b: Built,
  shown: AnnotationPlacement,
  next: AnnotationPlacement,
): AnnotationPlacement | null {
  const from = shown.layout;
  const to = next.layout;
  if (
    from.kind !== 'leader' ||
    to.kind !== 'leader' ||
    from.attach.kind !== 'dimensionLine' ||
    to.attach.kind !== 'dimensionLine'
  )
    return next;
  const target = to.attach.placementId;
  const end = dimensionLineEnd(to.attach.t);
  if (end === dimensionLineEnd(from.attach.t)) return next;
  if (end === takenEnd(b, from)) return null;
  const dim = b.build.placed.find((x) => x.placementId === target);
  if (!dim?.line) return next;
  return { ...next, layout: flipDimensionLineEnd(from, dim.line) };
}
