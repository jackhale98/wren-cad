/**
 * Links between separate shapes (ADR-087 amendment, 2026-11-23): announced when a click adds
 * them, removable in one step, shown at both shapes, and named while they carry a drag.
 */

import type { Id, SketchConstraint, SketchEntity, SketchFeature, Vec2 } from '@wren-cad/contracts';
import { ConnectedPieces, constraintRefs } from '@wren-cad/sketch';
import { describe, expect, it, vi } from 'vitest';
import { announceLinks, DragCarriers, type LinkHost, removeConstraints } from '../app/sketch-links';
import type { SketchUi } from '../app/state';
import { click, type DrawState, move, type SketchData, type SketchEdit, startDraw } from './draw';
import { linkHosts, linkNotice } from './links';

const TOL = 1.2;

/** Draws clicks into `data`; returns every edit committed. */
function draw(data: SketchData, state: DrawState, pts: readonly Vec2[]): SketchEdit[] {
  let s = state;
  const edits: SketchEdit[] = [];
  for (const p of pts) {
    s = move(s, data, p, TOL);
    const r = click(s, data);
    s = r.state;
    if (r.edit) {
      (data.entities as SketchEntity[]).push(...r.edit.entities);
      (data.constraints as SketchConstraint[]).push(...r.edit.constraints);
      edits.push(r.edit);
    }
  }
  return edits;
}

/** The lead's reproduction: a rectangle, then a line-tool shape beside it, drawn by hand. */
function leadScene() {
  const data: SketchData = { entities: [], constraints: [] };
  draw(data, startDraw('rectangle'), [
    [-60, -30],
    [-20, 10],
  ]);
  const rect = new Set(data.entities.map((e) => e.id));
  const edits = draw(data, startDraw('line'), [
    [20, -29.4],
    [50, -29.6],
    [50.3, 10.4],
    [20.2, 9.7],
    [20, -29.4],
  ]);
  return { data, rect, edits };
}

describe('linkNotice', () => {
  it('the lead scene: the clicks level with the rectangle are announced, in plain words', () => {
    const { data, rect, edits } = leadScene();
    const notices = edits.map((e) =>
      linkNotice(data, e.constraints, new Set(e.entities.map((x) => x.id))),
    );
    const said = notices.filter((n) => n !== null);
    expect(said.length).toBeGreaterThan(0);
    for (const n of said) {
      expect(n?.text).toMatch(/^Kept level with Point \d+ of another shape$/);
      for (const id of n?.ids ?? []) {
        const c = data.constraints.find((x) => x.id === id) as SketchConstraint;
        expect(c.kind).toBe('horizontalPoints');
        expect(constraintRefs(c).some((r) => rect.has(r))).toBe(true);
      }
    }
    // Every constraint touching both shapes was announced by its click.
    const announced = new Set(said.flatMap((n) => n?.ids ?? []));
    const linking = data.constraints.filter((c) => {
      const refs = constraintRefs(c);
      return refs.some((r) => rect.has(r)) && refs.some((r) => !rect.has(r) && !r.startsWith('@'));
    });
    expect(linking.map((c) => c.id).sort()).toEqual([...announced].sort());
  });

  it('a shape closing level with its own start, or touching the other shape, says nothing', () => {
    const data: SketchData = { entities: [], constraints: [] };
    const own = draw(data, startDraw('line'), [
      [10, 10],
      [50, 10.3],
      [50.2, 30],
      [10.3, 30.2],
      [10.2, 10.1],
    ]);
    for (const e of own)
      expect(linkNotice(data, e.constraints, new Set(e.entities.map((x) => x.id)))).toBeNull();
    // A line from the shape's corner, then level with its other corner: one piece, no notice.
    const touching = draw(data, startDraw('line'), [
      [50, 10.3],
      [80, 30.4],
    ]);
    for (const e of touching)
      expect(linkNotice(data, e.constraints, new Set(e.entities.map((x) => x.id)))).toBeNull();
  });

  it('a hexagon whose centre is level with a corner of a line-tool region is announced', () => {
    const data: SketchData = { entities: [], constraints: [] };
    draw(data, startDraw('line'), [
      [-60, -30],
      [-20, -29.6],
      [-19.6, 10.3],
      [-60.2, 9.8],
      [-60, -30],
    ]);
    const [hex] = draw(data, startDraw('polygon'), [
      [40, 10.6],
      [55, 30],
    ]);
    if (!hex) throw new Error('no hexagon');
    const n = linkNotice(data, hex.constraints, new Set(hex.entities.map((e) => e.id)));
    expect(n?.ids).toHaveLength(1);
    expect(n?.text).toMatch(/^Kept level with Point \d+ of another shape$/);
  });

  it('a link shows its glyph at each shape it links', () => {
    const { data } = leadScene();
    const pieces = new ConnectedPieces(data.entities, data.constraints);
    const link = data.constraints.find((c) => linkHosts(pieces, c).length > 0) as SketchConstraint;
    const hosts = linkHosts(pieces, link);
    expect(hosts).toHaveLength(2);
    expect(pieces.same(hosts[0] as Id, hosts[1] as Id)).toBe(false);
  });
});

function fakeHost(data: SketchData) {
  let f: SketchFeature = {
    id: 'sk',
    type: 'sketch',
    entities: [...data.entities],
    constraints: [...data.constraints],
  } as unknown as SketchFeature;
  const patches: Partial<SketchUi>[] = [];
  const labels: string[] = [];
  const host: LinkHost = {
    feature: () => f,
    patch: (p) => patches.push(p),
    commitEdit: async (edit, label) => {
      const next = edit(f);
      if (next.entities === f.entities && next.constraints === f.constraints) return;
      f = { ...f, ...next };
      labels.push(label);
    },
  };
  return { host, patches, labels, get: () => f };
}

describe('announceLinks and Remove', () => {
  it('toasts what was added with Remove; Remove deletes exactly those, in one undo step', async () => {
    vi.useFakeTimers();
    const { data, edits } = leadScene();
    const edit = edits.find((e) =>
      linkNotice(data, e.constraints, new Set(e.entities.map((x) => x.id))),
    ) as SketchEdit;
    const h = fakeHost(data);
    const toast = vi.fn();
    announceLinks(h.host, { toast }, edit);
    expect(toast).toHaveBeenCalledTimes(1);
    const [text, tone, action] = toast.mock.calls[0] as [
      string,
      string,
      { label: string; run: () => void },
    ];
    expect(text).toMatch(/^Kept level with/);
    expect(tone).toBe('info');
    expect(action.label).toBe('Remove');
    const ids = h.patches[0]?.announced ?? [];
    expect(ids.length).toBeGreaterThan(0);
    const before = h.get().constraints.length;
    action.run();
    await vi.runAllTimersAsync();
    expect(h.labels).toEqual([ids.length === 1 ? 'Remove constraint' : 'Remove constraints']);
    expect(h.get().constraints).toHaveLength(before - ids.length);
    expect(h.get().constraints.some((c) => ids.includes(c.id))).toBe(false);
    // A second Remove finds nothing: no empty undo step.
    await removeConstraints(h.host, ids);
    expect(h.labels).toHaveLength(1);
    vi.useRealTimers();
  });

  it('an edit that links nothing is not announced', () => {
    const data: SketchData = { entities: [], constraints: [] };
    const [e] = draw(data, startDraw('line'), [
      [0, 50],
      [30, 80],
    ]);
    const toast = vi.fn();
    announceLinks(fakeHost(data).host, { toast }, e as SketchEdit);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('DragCarriers', () => {
  it('names the link while the other shape moves, nothing while it stays', () => {
    const { data, rect } = leadScene();
    const pieces = new ConnectedPieces(data.entities, data.constraints);
    const other = data.entities.find((e) => e.kind === 'line' && !rect.has(e.id)) as SketchEntity;
    const carriers = new DragCarriers(data, other.id);
    expect(carriers.update(data.entities)).toEqual([]);
    const corner = data.entities.find((e) => e.kind === 'point' && rect.has(e.id)) as SketchEntity;
    const movedRect = data.entities.map((e) =>
      e.id === corner.id && e.kind === 'point' ? { ...e, y: e.y + 5 } : e,
    );
    const ids = carriers.update(movedRect);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const c = data.constraints.find((x) => x.id === id) as SketchConstraint;
      expect(pieces.links(c)).toBe(true);
    }
    // Unchanged result: the same array (no re-render per step).
    expect(carriers.update(movedRect)).toBe(ids);
  });
});
