/**
 * The sketch session's side of links between separate shapes (ADR-087 amendment, 2026-11-23):
 * a click that adds one is announced with a Remove action, and a drag that moves another shape
 * shows the links carrying it. Kept out of sketch-session.ts (past its soft size limit).
 */

import type { Id, SketchConstraint, SketchEntity, SketchFeature } from '@wren-cad/contracts';
import { PieceLinks, type SketchGeometry } from '@wren-cad/sketch';
import { linkNotice } from '../sketch/links';
import type { SketchUi, Toast } from './state';

/** What the helpers need from the session (and its workbench). */
export interface LinkHost {
  feature(): SketchFeature | null;
  patch(p: Partial<SketchUi>): void;
  commitEdit(
    edit: (cur: SketchFeature) => {
      entities: SketchFeature['entities'];
      constraints: SketchFeature['constraints'];
    },
    label: string,
  ): Promise<void>;
}

export interface Toaster {
  toast(text: string, tone: 'info' | 'error', action?: Toast['action']): void;
}

/** How long the just-added links stay highlighted (the toast's own time with an action). */
const ANNOUNCED_MS = 6000;
let announcedTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * After a drawing edit landed: when its constraints link the new geometry to another shape, say
 * so in a toast with Remove (one undo step), and highlight those links' glyphs meanwhile.
 */
export function announceLinks(
  host: LinkHost,
  toaster: Toaster,
  edit: { entities: readonly SketchEntity[]; constraints: readonly SketchConstraint[] },
): void {
  const f = host.feature();
  if (!f || edit.constraints.length === 0) return;
  const stored = new Set(f.constraints.map((c) => c.id));
  const added = edit.constraints.filter((c) => stored.has(c.id));
  const notice = linkNotice(f, added, new Set(edit.entities.map((e) => e.id)));
  if (!notice) return;
  host.patch({ announced: notice.ids });
  clearTimeout(announcedTimer);
  announcedTimer = setTimeout(() => host.patch({ announced: [] }), ANNOUNCED_MS);
  toaster.toast(notice.text, 'info', {
    label: 'Remove',
    run: () => removeConstraints(host, notice.ids),
  });
}

/** Removes the given constraints in one undo step (already gone: no step). */
export function removeConstraints(host: LinkHost, ids: readonly Id[]): Promise<void> {
  host.patch({ announced: [] });
  const drop = new Set(ids);
  return host.commitEdit(
    (cur) => {
      const keep = cur.constraints.filter((c) => !drop.has(c.id));
      return keep.length === cur.constraints.length
        ? cur
        : { entities: cur.entities, constraints: keep };
    },
    ids.length === 1 ? 'Remove constraint' : 'Remove constraints',
  );
}

const NONE: readonly Id[] = [];

/** Whether two entities' parameters (numbers) differ. */
function changed(a: SketchEntity, b: SketchEntity): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k in ra) if (typeof ra[k] === 'number' && ra[k] !== rb[k]) return true;
  return false;
}

/**
 * Per drag: which links carry the motion from the dragged entity's shape to another shape that
 * moved. Built once at the drag's start (pieces don't change during a drag); each step compares
 * the solved entities with the start.
 */
export class DragCarriers {
  private readonly links: PieceLinks;
  private readonly start: Map<Id, SketchEntity>;
  private last: readonly Id[] = NONE;

  constructor(
    sketch: SketchGeometry,
    private readonly entity: Id,
  ) {
    this.links = new PieceLinks(sketch);
    this.start = this.links.empty ? new Map() : new Map(sketch.entities.map((e) => [e.id, e]));
  }

  /** The carrying link ids for this step's entities (the same array while unchanged). */
  update(entities: readonly SketchEntity[]): readonly Id[] {
    if (this.links.empty) return NONE;
    const moved: Id[] = [];
    for (const e of entities) {
      const s = this.start.get(e.id);
      if (s && changed(s, e)) moved.push(e.id);
    }
    const next = this.links.carriers(this.entity, moved);
    const same = next.length === this.last.length && next.every((id, i) => id === this.last[i]);
    if (!same) this.last = next.length ? next : NONE;
    return this.last;
  }
}
