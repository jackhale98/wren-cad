import { ChevronDown, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../components/primitives';
import { groupIssues, type IssueGroup, type ReportIssue, severityCounts } from './groupIssues';

/** One issue of a PMI report: what (an annotation, a file entity), why, and what it cost. */
export type PmiReportEntry = ReportIssue;

export interface PmiReportProps {
  /** `Exported 18 annotations as PMI` / `Imported 12 annotations from bracket.step`. */
  title: string;
  /** Extra line under the counts, or the whole summary line when `counts` is absent. */
  summary?: string;
  /**
   * The summary line (`12 imported · 3 not imported · 2 approximated · 5 cosmetic`), counted from
   * the entries: zero counts are left out, the done count is always shown.
   */
  counts?: { done: number; verb: 'imported' | 'exported' };
  entries: readonly PmiReportEntry[];
  onDismiss(): void;
  size?: 'md' | 'touch';
  className?: string;
}

/** The summary line for `counts` and `entries`. */
export function reportSummary(
  counts: NonNullable<PmiReportProps['counts']>,
  entries: readonly PmiReportEntry[],
): string {
  const c = severityCounts(entries);
  return [
    `${counts.done} ${counts.verb}`,
    c.lost > 0 ? `${c.lost} not ${counts.verb}` : null,
    c.approximated > 0 ? `${c.approximated} approximated` : null,
    c.cosmetic > 0 ? `${c.cosmetic} cosmetic` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
}

const MAX_LABELS = 3;

function GroupRow({ g }: { g: IssueGroup }) {
  const tone =
    g.severity === 'lost'
      ? 'bg-warning-soft text-warning-text'
      : g.severity === 'approximated'
        ? 'bg-surface-2 text-fg'
        : 'bg-surface-2 text-fg-muted';
  const more = g.labels.length - MAX_LABELS;
  return (
    <li
      data-severity={g.severity}
      data-count={g.count}
      className={cn('rounded-control px-2 py-1 text-2xs', tone)}
    >
      {g.count === 1 ? (
        <>
          <span className="font-semibold">{g.labels[0]}</span>
          {g.severity === 'lost' ? ' — not included: ' : ' — '}
          {g.reason}
        </>
      ) : (
        <>
          <span className="font-semibold">{g.count}×</span> {g.reason}
          <span className="block text-fg-muted">
            {g.labels.slice(0, MAX_LABELS).join(', ')}
            {more > 0 ? ` and ${more} more` : ''}
          </span>
        </>
      )}
    </li>
  );
}

/**
 * M5a (ADR-100, ADR-101): the non-modal summary after a STEP PMI export or import: a counts line,
 * then the issues grouped by cause (one line and a count for a repeated one), `lost` first, then
 * `approximated`; `cosmetic` groups sit behind one line. Nothing is left out silently. Never
 * takes focus; dismissed by its close button. The lists open in place.
 */
export function PmiReport({
  title,
  summary,
  counts,
  entries,
  onDismiss,
  size = 'md',
  className,
}: PmiReportProps) {
  const groups = groupIssues(entries);
  const main = groups.filter((g) => g.severity !== 'cosmetic');
  const cosmetic = groups.filter((g) => g.severity === 'cosmetic');
  const cosmeticCount = cosmetic.reduce((n, g) => n + g.count, 0);
  const [open, setOpen] = useState(main.length > 0 && main.length <= 4);
  const [cosmeticOpen, setCosmeticOpen] = useState(false);
  const listId = useId();
  const cosmeticId = useId();
  const touch = size === 'touch';
  const lost = entries.some((e) => (e.severity ?? 'lost') === 'lost');
  const line = counts ? reportSummary(counts, entries) : summary;
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
        {lost ? (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
        ) : (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold" data-testid="pmi-report-title">
            {title}
          </p>
          {line ? (
            <p className="text-2xs text-fg-muted" data-testid="pmi-report-summary">
              {line}
            </p>
          ) : null}
          {counts && summary ? (
            <p className="text-2xs text-fg-muted" data-testid="pmi-report-extra">
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
      {main.length > 0 ? (
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
            {open ? 'Hide details' : `Show ${main.length} ${main.length === 1 ? 'item' : 'items'}`}
          </button>
          {open ? (
            <ul
              id={listId}
              data-testid="pmi-report-entries"
              className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0"
            >
              {main.map((g) => (
                <GroupRow key={g.key} g={g} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {cosmetic.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={cosmeticOpen}
            aria-controls={cosmeticId}
            data-testid="pmi-report-cosmetic-toggle"
            onClick={() => setCosmeticOpen((o) => !o)}
            className={cn(btn, 'self-start text-fg-muted hover:bg-surface-2')}
          >
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform duration-fast',
                cosmeticOpen && 'rotate-180',
              )}
              aria-hidden
            />
            {cosmeticOpen
              ? 'Hide cosmetic differences'
              : `${cosmeticCount} cosmetic ${cosmeticCount === 1 ? 'difference' : 'differences'} (every annotation is in; only how some are drawn differs)`}
          </button>
          {cosmeticOpen ? (
            <ul
              id={cosmeticId}
              data-testid="pmi-report-cosmetic"
              className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0"
            >
              {cosmetic.map((g) => (
                <GroupRow key={g.key} g={g} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
