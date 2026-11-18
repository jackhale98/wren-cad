import { ChevronDown, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../components/primitives';

/** One line of a PMI report: what (an annotation, a file entity) and why. */
export interface PmiReportEntry {
  /** The annotation or file entity, in words ("Diameter dimension Ø6", "Datum A", "GT7"). */
  label: string;
  reason: string;
  /** `skipped`: not exported or imported. `note`: done, with something to check. */
  tone: 'skipped' | 'note';
}

export interface PmiReportProps {
  /** `Exported 18 annotations as PMI` / `Imported 12 annotations from bracket.step`. */
  title: string;
  /** Short counts line (`2 skipped · 1 to check`). */
  summary?: string;
  entries: readonly PmiReportEntry[];
  onDismiss(): void;
  size?: 'md' | 'touch';
  className?: string;
}

/**
 * M5a (ADR-100): the non-modal summary after a STEP PMI export or import: how many annotations
 * went across, and every one that did not (or needs a look), each with its reason. Nothing is
 * left out silently. Never takes focus; dismissed by its close button. The list is collapsed
 * when long and opens in place.
 */
export function PmiReport({
  title,
  summary,
  entries,
  onDismiss,
  size = 'md',
  className,
}: PmiReportProps) {
  const [open, setOpen] = useState(entries.length > 0 && entries.length <= 4);
  const listId = useId();
  const touch = size === 'touch';
  const skipped = entries.filter((e) => e.tone === 'skipped').length;
  const btn = cn(
    'inline-flex items-center justify-center gap-1 rounded-control px-2 text-ui font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
    touch ? 'min-h-11 min-w-11' : 'h-7',
  );
  return (
    <div
      role="status"
      data-testid="pmi-report"
      className={cn(
        'flex flex-col gap-1.5 rounded-panel bg-surface p-3 text-ui text-fg shadow-pop',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {skipped > 0 ? (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
        ) : (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold" data-testid="pmi-report-title">
            {title}
          </p>
          {summary ? (
            <p className="text-2xs text-fg-muted" data-testid="pmi-report-summary">
              {summary}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid="pmi-report-dismiss"
          onClick={onDismiss}
          className={cn(btn, 'text-fg-muted hover:bg-surface-2')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {entries.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            className={cn(btn, 'self-start text-accent-text hover:bg-accent-soft')}
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform duration-fast', open && 'rotate-180')}
              aria-hidden
            />
            {open
              ? 'Hide details'
              : `Show ${entries.length} ${entries.length === 1 ? 'item' : 'items'}`}
          </button>
          {open ? (
            <ul
              id={listId}
              data-testid="pmi-report-entries"
              className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0"
            >
              {entries.map((e, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries are a fixed report
                  key={i}
                  data-tone={e.tone}
                  className={cn(
                    'rounded-control px-2 py-1 text-2xs',
                    e.tone === 'skipped'
                      ? 'bg-warning-soft text-warning-text'
                      : 'bg-surface-2 text-fg-muted',
                  )}
                >
                  <span className="font-semibold">{e.label}</span>
                  {e.tone === 'skipped' ? ' — not included: ' : ' — '}
                  {e.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
