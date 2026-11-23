import type { DeviceCapabilities, DeviceTier } from '@wren-cad/contracts';
import { capabilitiesFor } from '../platform/tier-policy';
import { writeFullEditor } from './input';
import type { Observable } from './observable';
import type { UiState } from './state';

/** What the layout switch needs from the workbench (kept narrow so it can be tested without one). */
export interface LayoutHost {
  readonly tier: DeviceTier;
  readonly fullEditor: Observable<boolean>;
  readonly capabilities: Observable<DeviceCapabilities>;
  readonly ui: Observable<UiState>;
  readonly sketch: { exit(finish?: boolean): void } | null;
  patchUi(patch: Partial<UiState>): void;
}

/**
 * Ends an open sketch or feature edit the way "Finish sketch" and the inspector's close do: edits
 * are already in the document (one undo step each), so nothing is discarded; an empty new sketch
 * is dropped, as on any finish. The same rule as opening another document mid-sketch (`files.ts`).
 */
export function finishOpenEdits(wb: LayoutHost): void {
  const u = wb.ui.get();
  if (u.sketch) wb.sketch?.exit(true);
  if (u.featureId || u.picking || u.prompt)
    wb.patchUi({ featureId: null, picking: null, prompt: null });
}

/**
 * Switches the review shell and the full editor (phone, ADR-101). Leaving the full editor first
 * finishes whatever edit is open, so the review layout (`editSketches` false) never keeps one.
 */
export function setFullEditor(wb: LayoutHost, on: boolean): void {
  const next = capabilitiesFor(wb.tier, { fullEditor: on });
  if (!next.editSketches || !next.editFeatures) finishOpenEdits(wb);
  writeFullEditor(on);
  wb.fullEditor.set(on);
  wb.capabilities.set(next);
}
