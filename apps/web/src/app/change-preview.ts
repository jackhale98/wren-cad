/**
 * Change preview (ADR-103): while a feature is created or edited, the faces it made are tinted by
 * effect, a blind extrude shows its swept volume before the kernel answers, the exact solid the
 * feature adds or removes is drawn translucent (slice 2e.2), and a held key (touch: the Before
 * chip) shows the model as it was before the feature.
 *
 * Nothing here calls the kernel or edits the document. The tint and the solid follow the displayed
 * regen result (so they appear in the frame the result does, and are gone when the feature errors
 * or the edit ends); the solid is the one that result carries (`RegenResult.preview`, asked for
 * with the regen of the edited feature), never one of earlier values. The prism is drawn
 * synchronously from the input and dropped when the regen of the current document arrives; while
 * it is up it stands in for the solid. Before reuses the pick rollback of `view-doc.ts`.
 */

import type {
  Feature,
  FeatureEffect,
  FeaturePreview,
  FeatureTint,
  Id,
  MeshBuffers,
  RegenResult,
  RegionPrismSpec,
  TouchViewport,
} from '@wren-cad/contracts';
import { extrudePrism, featureEffect, hasSolidPreview, ownedFaces } from '../model/feature-effect';
import type { RegenView } from './state';
import type { Workbench } from './workbench';

/**
 * The viewport engine's method for the preview solid (proposed for the contract, ADR-103): any
 * other viewport simply draws nothing.
 */
type SolidViewport = TouchViewport & {
  setFeatureSolid?(spec: { effect: FeatureEffect; meshes: readonly MeshBuffers[] } | null): void;
};

export interface ChangePreviewState {
  tint: { featureId: Id; effect: FeatureEffect; faces: number } | null;
  prism: { featureId: Id; effect: 'add' | 'cut'; distance: number } | null;
  /** The exact solid on screen: what it is and its volume (mm³). */
  solid: {
    featureId: Id;
    effect: FeaturePreview['effect'];
    shows: FeaturePreview['shows'];
    volume: number;
    meshes: number;
  } | null;
  before: boolean;
}

export class ChangePreview {
  /** `KeyboardEvent.code` of the key held for Before (its release ends it). */
  holdCode: string | null = null;
  private tint: ChangePreviewState['tint'] = null;
  private prism: { featureId: Id; spec: RegionPrismSpec } | null = null;
  /** The full result shown when Before was pressed: restored in the frame the key is released. */
  private stash: RegenView | null = null;

  constructor(private readonly wb: Workbench) {}

  /** The change-preview methods are optional in the contract: other viewports draw nothing. */
  private get vp(): SolidViewport | null {
    return this.wb.viewport;
  }

  state(): ChangePreviewState {
    return {
      tint: this.tint,
      prism: this.prism
        ? {
            featureId: this.prism.featureId,
            effect: this.prism.spec.effect,
            distance: this.prism.spec.distance,
          }
        : null,
      solid: this.solid && {
        featureId: this.solid.featureId,
        effect: this.solid.effect,
        shows: this.solid.shows,
        volume: this.solid.volume,
        meshes: this.solid.meshes.length,
      },
      before: this.wb.ui.get().before,
    };
  }

  /**
   * The feature whose preview solid the next regen should carry (`RegenRequest.preview`), or null:
   * nothing is edited, a sketch, push/pull or Before is up, or the feature's kind has no solid.
   * Read from the document being regenerated (the active configuration's own).
   */
  requestId(): Id | null {
    const u = this.wb.ui.get();
    if (!u.featureId || u.sketch || u.before || u.pushPull) return null;
    const f = this.wb
      .viewDoc()
      .parts[0]?.features.find((x) => x.id === u.featureId && !x.suppressed);
    return f && hasSolidPreview(f) ? f.id : null;
  }

  /** The feature being created or edited in the inspector (not a sketch, not while viewing Before). */
  private editedFeature(view: RegenView | null): Feature | undefined {
    const u = this.wb.ui.get();
    if (!u.featureId || u.sketch || u.before || u.pushPull) return undefined;
    return view?.doc.parts[0]?.features.find((f) => f.id === u.featureId && !f.suppressed);
  }

  /** The live result on screen is of the displayed document and already carries this solid. */
  carries(featureId: Id): boolean {
    const v = this.wb.regen.get();
    return (
      v?.source === 'live' &&
      v.doc === this.wb.viewDoc() &&
      v.result.preview?.featureId === featureId
    );
  }

  /** After a regen result is applied and when what is edited changes: tint and prism follow. */
  sync(): void {
    const view = this.wb.regen.get();
    // Runs on every UI change (hover too): skip unless an input of the tint changed.
    const u = this.wb.ui.get();
    const stamp = { view, id: u.featureId, flags: `${!!u.sketch}${u.before}${!!u.pushPull}` };
    const s = this.stamp;
    if (!this.prism && s && s.view === stamp.view && s.id === stamp.id && s.flags === stamp.flags)
      return;
    this.stamp = stamp;
    const f = view === this.cleared ? undefined : this.editedFeature(view);
    this.syncTint(view, f);
    this.syncPrism(view, f);
    this.syncSolid();
  }

  /**
   * The exact solid follows the displayed live result: shown when that result carries the preview
   * of the edited feature, gone in every other case (the edit ended, the feature errored or was
   * rolled back, undo, Before, a cached first frame). The extrude prism stands in for it while the
   * regen of a new value is on its way.
   */
  private syncSolid(): void {
    const view = this.wb.regen.get();
    const f = view === this.cleared ? undefined : this.editedFeature(view);
    const p = f && !this.prism && view?.source === 'live' ? view.result.preview : undefined;
    const next = p && f && p.featureId === f.id && p.meshes.length > 0 ? p : null;
    if (next === this.solid) return;
    this.solid = next;
    this.vp?.setFeatureSolid?.(next && { effect: next.effect, meshes: next.meshes });
  }
  private solid: FeaturePreview | null = null;

  private syncTint(view: RegenView | null, f: Feature | undefined): void {
    const next = f && view?.source === 'live' ? tintFor(f, view.result) : null;
    const same =
      next === null
        ? this.tint === null
        : this.tint?.featureId === next.featureId &&
          this.tint.effect === next.effect &&
          this.tint.faces === next.faces &&
          this.tintedResult === view?.result;
    if (same) return;
    this.tint = next && { featureId: next.featureId, effect: next.effect, faces: next.faces };
    this.tintedResult = next ? view?.result : undefined;
    this.vp?.setFeatureTint?.(next ? { effect: next.effect, faces: next.bodies } : null);
  }
  private tintedResult: RegenResult | undefined;
  /** The result on screen when undo / Before cleared the tint: it is not tinted again; the next one is. */
  private cleared: RegenView | null = null;
  private stamp: { view: RegenView | null; id: Id | null; flags: string } | null = null;

  private syncPrism(view: RegenView | null, f: Feature | undefined): void {
    const p = this.prism;
    if (!p) return;
    // Gone when the edit ends, when the feature is not the edited one any more, and once the
    // regen of the current document is shown (its real, tinted faces replace the estimate).
    const arrived = view?.source === 'live' && view.doc === this.wb.viewDoc();
    if (!f || f.id !== p.featureId || arrived) this.clearPrism();
  }

  private clearPrism(): void {
    if (!this.prism) return;
    this.prism = null;
    this.vp?.setRegionPrism?.(null);
  }

  /**
   * A value of `feature` just changed (drag, typed, inspector): the swept volume of a blind
   * extrude appears in this frame, from the sketch region and the evaluated depth. Anything that
   * cannot be exact shows nothing.
   */
  onFeature(feature: Feature): void {
    this.prismFor(feature);
    this.syncSolid();
  }

  private prismFor(feature: Feature): void {
    const vp = this.vp;
    if (!vp?.setRegionPrism) return;
    const view = this.wb.regen.get();
    if (feature.type !== 'extrude' || !view || this.wb.ui.get().before) {
      this.clearPrism();
      return;
    }
    // No change to show when the displayed result already is this document.
    if (view.source === 'live' && view.doc === this.wb.viewDoc()) {
      this.clearPrism();
      return;
    }
    let depth: number | null = null;
    if (feature.end.kind === 'blind') {
      const r = this.wb.evaluate(feature.end.depth, 'length');
      depth = r.ok ? r.value : null;
    }
    let drafted = false;
    if (feature.draft !== undefined && feature.draft.trim() !== '') {
      const r = this.wb.evaluate(feature.draft, 'angle');
      drafted = !r.ok || Math.abs(r.value) > 1e-9;
    }
    const spec = extrudePrism(feature, view.result.sketches, depth, drafted);
    if (!spec) {
      this.clearPrism();
      return;
    }
    this.prism = { featureId: feature.id, spec };
    vp.setRegionPrism(spec);
  }

  /** Everything off (undo, redo, document replaced). The next regen result may tint again. */
  clear(): void {
    this.stamp = null;
    this.cleared = this.wb.regen.get() ?? null;
    this.clearPrism();
    if (this.tint) {
      this.tint = null;
      this.tintedResult = undefined;
      this.vp?.setFeatureTint?.(null);
    }
    this.syncSolid();
  }

  /**
   * Whether the canvas shows more or less than the plain model (tint, swept volume, the exact
   * solid, Before).
   */
  showing(): boolean {
    return (
      this.tint !== null || this.prism !== null || this.solid !== null || this.wb.ui.get().before
    );
  }

  /** Whether Before can be shown now: a feature is open and some feature stands before it. */
  canShowBefore(): boolean {
    const u = this.wb.ui.get();
    const part = this.wb.part;
    if (!u.featureId || u.sketch || !part) return false;
    const i = part.features.findIndex((f) => f.id === u.featureId);
    return i >= 0 && i < part.rollbackIndex && part.features[i]?.type !== 'sketch';
  }

  /**
   * Hold-to-see: the model without the edited feature (the rolled-back view the pick fields use,
   * served by the regen cache). Never an edit: only a UI flag changes, so nothing reaches the
   * document or the undo history. Releasing shows the stashed result again in the same frame.
   */
  setBefore(on: boolean): void {
    const wb = this.wb;
    if (on === wb.ui.get().before) return;
    if (on) {
      if (!this.canShowBefore()) return;
      this.stash = wb.regen.get() ?? null;
      this.clear();
      wb.patchUi({ before: true });
      return;
    }
    const stash = this.stash;
    this.stash = null;
    wb.patchUi({ before: false });
    this.cleared = null;
    this.stamp = null;
    if (stash && stash.doc === wb.viewDoc()) {
      wb.regen.set(stash);
      wb.syncViewport();
    }
  }
}

function tintFor(
  f: Feature,
  result: RegenResult,
): { featureId: Id; effect: FeatureEffect; faces: number; bodies: FeatureTint['faces'] } | null {
  const status = result.features.find((s) => s.featureId === f.id);
  // An error, an unresolved reference or a blocked feature tints nothing: the error state shows.
  if (!status || status.state !== 'ok') return null;
  const effect = featureEffect(f);
  if (!effect) return null;
  const bodies = ownedFaces(result.bodies, f.id);
  if (bodies.length === 0) return null;
  return {
    featureId: f.id,
    effect,
    faces: bodies.reduce((n, b) => n + b.faces.length, 0),
    bodies,
  };
}
