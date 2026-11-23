/**
 * "Before" press-and-hold (change preview, ADR-103): while the chip is held the model shows as it
 * was before the feature being edited; letting go shows it with the feature again. The touch
 * counterpart of the Before key. It only changes a UI flag: never an edit, never in the undo
 * history. 44 px, shown beside the inspector / values pane when something stands before the
 * feature.
 */

import { useObservable } from '../app/observable';
import type { Workbench } from '../app/workbench';
import { beforeChipHandlers } from './before-chip-handlers';

export default function BeforeChip({ wb }: { wb: Workbench }) {
  const ui = useObservable(wb.ui);
  useObservable(wb.regen); // the document changes with edits: re-check there is a "before"
  if (!ui.featureId || !wb.changePreview.canShowBefore()) return null;
  const on = ui.before;
  const { hold, release, isActivation } = beforeChipHandlers(wb.changePreview);
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 min-w-11 touch-none items-center justify-center rounded-[12px] border px-4 text-ui font-medium select-none ${
        on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong bg-surface text-fg'
      }`}
      aria-pressed={on}
      aria-label="Before: hold to see the model without this feature"
      data-testid="before-chip"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        hold();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (isActivation(e.key) && !e.repeat) {
          e.preventDefault();
          hold();
        }
      }}
      onKeyUp={(e) => {
        if (isActivation(e.key)) release();
      }}
      onBlur={release}
    >
      Before
    </button>
  );
}
