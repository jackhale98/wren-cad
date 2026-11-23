/**
 * A click on something selected deselects it (owner, 2026-11-23), but a double click is one
 * gesture (zoom to it, edit it), not "select, then deselect". This remembers the last click so
 * the second click of a double click leaves the selection as the first click made it... or, on
 * something that was already selected, puts it back: either way a double click ends selected.
 */

/** As the gesture recogniser's double-tap window (`DOUBLE_TAP_MAX_MS` in @wren-cad/viewport). */
export const DOUBLE_CLICK_MS = 300;

export type ClickEffect = 'select' | 'deselect' | 'keep';

export class ToggleGuard {
  private last: { key: string; at: number; selected: boolean } | null = null;

  /** What a click on `key` does, given whether it is selected now. */
  click(key: string, selectedNow: boolean, now: number = performance.now()): ClickEffect {
    const l = this.last;
    const second = l !== null && l.key === key && now - l.at <= DOUBLE_CLICK_MS;
    if (selectedNow && second && l?.selected) {
      // The first click selected it: the second belongs to the same double click.
      this.last = null;
      return 'keep';
    }
    this.last = { key, at: now, selected: !selectedNow };
    return selectedNow ? 'deselect' : 'select';
  }
}
