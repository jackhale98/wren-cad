/**
 * M5a (ADR-100): the PMI export/import report in the viewport overlay, non-modal: it never takes
 * focus and stays until dismissed (a second export or import replaces it). Lazy: loaded only
 * when there is a report.
 */

import { PmiReport } from '@wren-cad/ui';
import { useObservable } from '../app/observable';
import type { Workbench } from '../app/workbench';

export function PmiNotice({ wb, touch }: { wb: Workbench; touch: boolean }) {
  const ui = useObservable(wb.ui);
  const r = ui.pmiReport;
  if (!r) return null;
  return (
    <div
      className="pointer-events-auto absolute right-3 w-[min(26rem,calc(100%-1.5rem))]"
      style={{ bottom: 'calc(var(--chrome-bottom, 5.75rem) + 12px)' }}
      data-testid={`pmi-notice-${r.kind}`}
    >
      <PmiReport
        key={r.id}
        title={r.title}
        {...(r.summary ? { summary: r.summary } : {})}
        {...(r.counts ? { counts: r.counts } : {})}
        entries={r.entries}
        size={touch ? 'touch' : 'md'}
        onDismiss={() => wb.patchUi({ pmiReport: null })}
      />
    </div>
  );
}
