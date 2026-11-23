/**
 * Sketch selection by click or tap (owner, iPad, 2026-11-23: "no way to select more than one
 * vertex or line"). Touch and Pencil have no modifier key, so a tap adds to the selection; a
 * mouse click replaces it unless Shift / Ctrl / Cmd is held. Either way, clicking or tapping
 * something already selected removes it (the app-wide rule, `selectHit` in app/pointer.ts), and
 * a click or tap on empty space clears the selection (the caller).
 */

import type { Id } from '@wren-cad/contracts';

export interface SelectInput {
  pointerType?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

/** True when a click or tap adds to the selection instead of replacing it. */
export function additiveSelect(e: SelectInput): boolean {
  return !!(e.shiftKey || e.metaKey || e.ctrlKey) || (!!e.pointerType && e.pointerType !== 'mouse');
}

/**
 * The selection after a click or tap on `id`. `toggle` false keeps a selected entity selected
 * (the Point tool landing on an existing point selects it).
 */
export function nextSelection(
  selected: readonly Id[],
  id: Id,
  additive: boolean,
  toggle = true,
): Id[] {
  if (selected.includes(id)) return toggle ? selected.filter((x) => x !== id) : [...selected];
  return additive ? [...selected, id] : [id];
}
