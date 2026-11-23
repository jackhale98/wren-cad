/**
 * ADR-101: groups the issues of an import or export report so a repeated cause reads as one line
 * with a count, ranked by what it cost. Pure and generic (PMI now, assembly import next).
 */

/** What an issue cost: `lost` an item did not come across, `approximated` it came changed, `cosmetic` only how it is drawn differs. */
export type IssueSeverity = 'lost' | 'approximated' | 'cosmetic';

export interface ReportIssue {
  /** The item, in words ("Diameter dimension Ø6", "GT7"). */
  label: string;
  reason: string;
  /** Stable key for one cause; absent = group by `reason`. */
  code?: string;
  /** Absent = `lost`. */
  severity?: IssueSeverity;
}

export interface IssueGroup {
  /** The `code`, else the `reason`. */
  key: string;
  /** The most severe of its issues. */
  severity: IssueSeverity;
  /** The first issue's reason. */
  reason: string;
  /** Number of issues. */
  count: number;
  /** Their labels, in input order. */
  labels: string[];
}

const RANK: Record<IssueSeverity, number> = { lost: 0, approximated: 1, cosmetic: 2 };

/**
 * Groups by `code` (else `reason`), ordered `lost`, `approximated`, `cosmetic`; within a severity
 * by count (largest first), then first appearance. A missing severity means `lost`.
 */
export function groupIssues(issues: readonly ReportIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const i of issues) {
    const severity = i.severity ?? 'lost';
    const key = i.code ?? i.reason;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, severity, reason: i.reason, count: 1, labels: [i.label] });
      continue;
    }
    g.count++;
    g.labels.push(i.label);
    if (RANK[severity] < RANK[g.severity]) g.severity = severity;
  }
  const order = new Map([...groups.keys()].map((k, n) => [k, n]));
  return [...groups.values()].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      b.count - a.count ||
      (order.get(a.key) as number) - (order.get(b.key) as number),
  );
}

/** Issue counts per severity (issues, not groups). */
export function severityCounts(issues: readonly ReportIssue[]): Record<IssueSeverity, number> {
  const out: Record<IssueSeverity, number> = { lost: 0, approximated: 0, cosmetic: 0 };
  for (const i of issues) out[i.severity ?? 'lost']++;
  return out;
}
