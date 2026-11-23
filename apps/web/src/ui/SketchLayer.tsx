/**
 * The sketch overlay: constraint glyphs, inference glyphs and the dimensions. Lazy: sketch mode
 * only, so none of it is on the initial route.
 */

import type { Id, SketchConstraint, SketchFeature, WrenDoc } from '@wren-cad/contracts';
import { ConnectedPieces, constraintLabel, isSketchReference, Namer } from '@wren-cad/sketch';
import { ConstraintGlyph, cn } from '@wren-cad/ui';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { SketchSession } from '../app/sketch-session';
import type { SketchUi } from '../app/state';
import type { Workbench } from '../app/workbench';
import { linkHosts } from '../sketch/links';
import { entityAnchor } from '../sketch/overlay';
import { displayFeature } from '../sketch/shown';

const SketchDimensions = lazy(() => import('./SketchDimensions'));

function useCameraTick(session: SketchSession | null): number {
  const [, force] = useState(0);
  useEffect(() => {
    if (!session) return;
    return session.camera.subscribe(() => force((n) => n + 1));
  }, [session]);
  return session ? session.camera.get() : 0;
}

const GLYPH_KINDS = new Set([
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'tangent',
  'equal',
  'midpoint',
  'concentric',
  'symmetric',
  'fix',
]);

/** The entity a constraint's glyph sits on: never the origin or an axis (ADR-017). */
function glyphHost(c: SketchConstraint): Id | null {
  const user = (...ids: Id[]) => ids.find((id) => !isSketchReference(id)) ?? null;
  switch (c.kind) {
    case 'horizontal':
    case 'vertical':
      return c.line;
    case 'midpoint':
      return user(c.point, c.line);
    case 'fix':
      return c.entity;
    case 'symmetric':
      return user(c.about, c.a, c.b);
    default:
      return 'a' in c && typeof c.a === 'string' && typeof c.b === 'string' ? user(c.a, c.b) : null;
  }
}

export default function SketchLayer({
  wb,
  session,
  ui,
  doc,
  touch = false,
}: {
  wb: Workbench;
  session: SketchSession;
  ui: SketchUi;
  doc: WrenDoc;
  touch?: boolean;
}) {
  useCameraTick(session);
  const v = wb.viewport;
  const stored = doc.parts[0]?.features.find((x) => x.id === ui.featureId) as
    | SketchFeature
    | undefined;
  // Which shapes are connected (topology only: recomputed when the sketch changes, not per frame).
  const pieces = useMemo(
    () =>
      stored?.type === 'sketch' ? new ConnectedPieces(stored.entities, stored.constraints) : null,
    [stored],
  );
  if (!v || !stored || stored.type !== 'sketch' || !ui.frame || !pieces) return null;
  // Geometry and labels as solved for the values in force (display only; the document is untouched).
  const f = displayFeature(stored, ui.shown);
  const screen = (p: [number, number]) => {
    const w = session.world(p);
    return w ? v.worldToScreen(w) : null;
  };
  const namer = new Namer(f.entities);
  const driven = ui.solve?.driven ?? {};
  const conflicting = new Set(ui.solve?.conflicts.flatMap((c) => c.constraints) ?? []);

  // Constraint glyphs, stacked per host entity. A constraint linking two separate shapes (ADR-087
  // amendment) shows at each shape, whatever its kind, so the link is never hidden.
  const perHost = new Map<Id, number>();
  const carrying = new Set([...(ui.carrying ?? []), ...(ui.announced ?? [])]);
  const glyphs = f.constraints.flatMap((c) => {
    const linked = linkHosts(pieces, c);
    const hosts = linked.length ? linked : GLYPH_KINDS.has(c.kind) ? [glyphHost(c)] : [];
    return hosts.flatMap((host, end) => {
      const at = host ? entityAnchor(f.entities, host) : null;
      const p = at ? screen(at) : null;
      if (!host || !p?.visible) return [];
      const k = perHost.get(host) ?? 0;
      perHost.set(host, k + 1);
      return [{ c, end, linked: linked.length > 0, x: p.x + 10 + k * 22, y: p.y - 22 }];
    });
  });
  const picking = !ui.tool && !ui.edit;
  const selectedGlyph = picking ? glyphs.find((g) => g.c.id === ui.selectedConstraint) : undefined;

  const cursor = ui.draw?.cursor ? screen(ui.draw.cursor) : null;

  return (
    <>
      {glyphs.map(({ c, end, linked, x, y }) => (
        <button
          key={`${c.id}:${end}`}
          type="button"
          aria-label={`${constraintLabel(c, namer, driven)}${linked ? ', links two shapes' : ''}`}
          aria-pressed={ui.selectedConstraint === c.id}
          onClick={() => session.selectConstraint(ui.selectedConstraint === c.id ? null : c.id)}
          // A long press (touch, Pencil) or a right click selects it too: its Remove chip shows.
          onContextMenu={(e) => {
            e.preventDefault();
            session.selectConstraint(c.id);
          }}
          className={cn(
            'absolute rounded-[7px] transition-shadow',
            // While a tool is active its clicks go to the geometry under the glyph (links sit at
            // end points, where trims and snaps land); with the Select tool glyphs take clicks.
            picking ? 'pointer-events-auto' : 'pointer-events-none',
            (ui.selectedConstraint === c.id || carrying.has(c.id)) &&
              'shadow-[0_0_0_2px_var(--color-accent)]',
          )}
          style={{ left: x, top: y }}
          data-testid="constraint-glyph"
          data-kind={c.kind}
          data-constraint-id={c.id}
          data-link={linked ? '' : undefined}
          data-carrying={carrying.has(c.id) ? '' : undefined}
        >
          <ConstraintGlyph
            kind={c.kind}
            size={20}
            tone={
              conflicting.has(c.id)
                ? 'conflict'
                : ui.selectedConstraint === c.id
                  ? 'selected'
                  : carrying.has(c.id)
                    ? 'hint'
                    : 'placed'
            }
          />
        </button>
      ))}
      {selectedGlyph ? (
        <button
          type="button"
          data-testid="remove-constraint"
          onClick={() => session.deleteConstraint(selectedGlyph.c.id)}
          className={cn(
            'w-panel pointer-events-auto absolute rounded-control px-2.5 text-ui font-medium text-danger-text hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent',
            touch ? 'min-h-11' : 'h-7',
          )}
          style={{
            left: selectedGlyph.x + (touch ? 34 : 26),
            top: selectedGlyph.y + (touch ? -12 : -4),
          }}
        >
          Remove constraint
        </button>
      ) : null}
      <Suspense fallback={null}>
        <SketchDimensions
          wb={wb}
          session={session}
          ui={ui}
          f={f}
          driven={driven}
          conflicting={conflicting}
        />
      </Suspense>
      {cursor?.visible && ui.draw?.glyphs.length ? (
        <div
          className="pointer-events-none absolute flex gap-1"
          style={{ left: cursor.x + 14, top: cursor.y + 12 }}
          data-testid="inference-glyphs"
        >
          {ui.draw.glyphs.map((k) => (
            <ConstraintGlyph key={k} kind={k} size={20} tone="hint" labelled />
          ))}
        </div>
      ) : null}
    </>
  );
}
