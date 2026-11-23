import type { EvalResult, Expr, Tolerance } from '@wren-cad/contracts';

/** The seven choices of the tolerance editor, in the order they are offered. */
export const TOLERANCE_TYPES = [
  'none',
  'symmetric',
  'bilateral',
  'limits',
  'fit',
  'basic',
  'reference',
] as const;
export type ToleranceType = (typeof TOLERANCE_TYPES)[number];

export const TOLERANCE_TYPE_NAMES: Record<ToleranceType, string> = {
  none: 'None',
  symmetric: 'Symmetric',
  bilateral: 'Deviation',
  limits: 'Limits',
  fit: 'Fit',
  basic: 'Basic',
  reference: 'Reference',
};

/** One line saying what the type does, shown under the tiles. */
export const TOLERANCE_TYPE_HELP: Record<ToleranceType, string> = {
  none: 'No tolerance: the general tolerance of the sheet applies.',
  symmetric: 'One value, plus and minus: 25 ±0.1.',
  bilateral: 'An upper and a lower deviation from the size, each with its sign.',
  limits: 'The two limit sizes themselves: 25.1 over 24.9.',
  fit: 'An ISO 286 fit class for a hole, a shaft or both.',
  basic: 'A theoretically exact size, drawn in a box. It has no tolerance of its own.',
  reference: 'For information only, drawn in parentheses. It is not toleranced and not checked.',
};

export const toleranceType = (t: Tolerance | undefined): ToleranceType =>
  t === undefined ? 'none' : t.kind === 'bilateral' ? 'bilateral' : t.kind;

/** What a fit class lookup returns (ISO 286, mm): the document package's `fitDeviations`. */
export type FitLookup = { ok: true; upper: number; lower: number } | { ok: false; reason: string };

/** What the editor needs from ISO 286, wired by the app (the table lives in the document package). */
export interface FitSupport {
  /** Deviations (mm, signed) of a class at a nominal size, or why there are none. */
  deviations(fitClass: string, sizeMm: number): FitLookup;
  /** The letters and grades that have a value at the size; empty outside the table. */
  choices(side: 'hole' | 'shaft', sizeMm: number): { letter: string; grades: number[] }[];
  /** The largest size the table covers (mm). */
  maxSize: number;
}

export interface SwitchContext {
  quantity: 'length' | 'angle';
  evaluate(expr: Expr): EvalResult;
  /** The dimension's size (mm), for fits. */
  size?: number;
  fits?: FitSupport;
}

/** Shortest round-trip number text, no exponent, no `-0`. */
export function numText(n: number): string {
  const s = String(Number(n.toPrecision(12)));
  return s === '-0' ? '0' : s;
}

export const unitOf = (quantity: 'length' | 'angle'): 'mm' | 'deg' =>
  quantity === 'angle' ? 'deg' : 'mm';

const SIMPLE = /^\s*([+\-−–])?\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-zA-Z°]*)\s*$/;

/** Flips the sign of an expression: `0.1 mm` → `-0.1 mm`, `a+b` → `-(a+b)`. */
export function negate(e: Expr): Expr {
  const m = SIMPLE.exec(e);
  if (m) {
    const neg = m[1] === '-' || m[1] === '−' || m[1] === '–';
    const num = m[2] as string;
    if (Number(num) === 0) return `0${m[3] ? ` ${m[3]}` : ''}`;
    return `${neg ? '' : '-'}${num}${m[3] ? ` ${m[3]}` : ''}`;
  }
  const t = e.trim();
  return t.startsWith('-(') && t.endsWith(')') ? t.slice(2, -1) : `-(${t})`;
}

/** A bare number is sheet mm (deg); a leading `+` is dropped; units and expressions stay. */
export function toleranceExpr(text: string, quantity: 'length' | 'angle'): Expr {
  const t = text
    .trim()
    .replace(/^\+\s*/, '')
    .replace(/[−–]/g, '-');
  const unit = unitOf(quantity);
  return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? `${t} ${unit}` : t;
}

/** An evaluated expression in the unit of the field (mm or degrees), or undefined. */
export function valueIn(
  e: Expr,
  quantity: 'length' | 'angle',
  evaluate: (expr: Expr) => EvalResult,
): number | undefined {
  const r = evaluate(e);
  if (!r.ok || !Number.isFinite(r.value)) return undefined;
  return quantity === 'angle' ? (r.value * 180) / Math.PI : r.value;
}

/** A number as a stored expression: `0.021` → `0.021 mm`. */
export const numberExpr = (n: number, quantity: 'length' | 'angle'): Expr =>
  `${numText(Math.round(n * 1e9) / 1e9)} ${unitOf(quantity)}`;

/** Deviations of a tolerance as expressions, when it has them without a lookup. */
function deviationExprs(
  t: Tolerance | undefined,
  ctx: SwitchContext,
): { upper: Expr; lower: Expr } | undefined {
  if (!t) return undefined;
  switch (t.kind) {
    case 'symmetric':
      return { upper: t.value, lower: negate(t.value) };
    case 'bilateral':
    case 'limits':
      return { upper: t.upper, lower: t.lower };
    case 'fit': {
      const first = [t.hole, t.shaft].find((c): c is string => !!c);
      if (!first || ctx.size === undefined || !ctx.fits || ctx.quantity === 'angle')
        return undefined;
      const r = ctx.fits.deviations(first, ctx.size);
      return r.ok
        ? { upper: numberExpr(r.upper, 'length'), lower: numberExpr(r.lower, 'length') }
        : undefined;
    }
    default:
      return undefined;
  }
}

const DEFAULT_VALUE = (q: 'length' | 'angle'): Expr => (q === 'angle' ? '0.5 deg' : '0.1 mm');

/** The default class when a fit is first chosen: H7 if the size has it, else the first class. */
export function defaultFit(
  size: number | undefined,
  fits: FitSupport | undefined,
): { hole?: string; shaft?: string } | undefined {
  if (size === undefined || !fits) return undefined;
  const hole = fits.choices('hole', size);
  const h7 = hole.find((c) => c.letter === 'H' && c.grades.includes(7));
  if (h7) return { hole: 'H7' };
  const first = hole[0];
  const grade = first?.grades.includes(7) ? 7 : first?.grades[Math.floor(first.grades.length / 2)];
  return first && grade !== undefined ? { hole: `${first.letter}${grade}` } : undefined;
}

/**
 * The tolerance after switching the type: what can be kept is kept (± 0.1 → +0.1 / −0.1 → limits;
 * a fit's deviations become deviations), the rest starts from a sensible default. `null`
 * removes the tolerance; `undefined` means the type cannot be entered (a fit with no size).
 * The dimension's nominal is never touched here.
 */
export function switchTolerance(
  from: Tolerance | undefined,
  to: ToleranceType,
  ctx: SwitchContext,
): Tolerance | null | undefined {
  if (toleranceType(from) === to) return from ?? null;
  switch (to) {
    case 'none':
      return null;
    case 'basic':
    case 'reference':
      return { kind: to };
    case 'symmetric': {
      const d = deviationExprs(from, ctx);
      if (!d) return { kind: 'symmetric', value: DEFAULT_VALUE(ctx.quantity) };
      const up = valueIn(d.upper, ctx.quantity, ctx.evaluate);
      const lo = valueIn(d.lower, ctx.quantity, ctx.evaluate);
      // The larger side, as a positive value; equal sides keep the typed text.
      if (up === undefined || lo === undefined || Math.abs(up) >= Math.abs(lo)) {
        return { kind: 'symmetric', value: up !== undefined && up < 0 ? negate(d.upper) : d.upper };
      }
      return { kind: 'symmetric', value: lo < 0 ? negate(d.lower) : d.lower };
    }
    case 'bilateral':
    case 'limits': {
      const d = deviationExprs(from, ctx);
      if (!d) {
        const v = DEFAULT_VALUE(ctx.quantity);
        return { kind: to, upper: v, lower: negate(v) };
      }
      return { kind: to, upper: d.upper, lower: d.lower };
    }
    case 'fit': {
      if (ctx.quantity === 'angle') return undefined;
      const d = defaultFit(ctx.size, ctx.fits);
      return d ? { kind: 'fit', ...d, show: 'symbol' } : undefined;
    }
  }
}

/** The order check of a deviation pair: `undefined` when it is fine or cannot be evaluated. */
export function pairProblem(
  upper: Expr,
  lower: Expr,
  quantity: 'length' | 'angle',
  evaluate: (expr: Expr) => EvalResult,
  words: { upper: string; lower: string } = { upper: 'upper deviation', lower: 'lower deviation' },
): string | undefined {
  const u = valueIn(upper, quantity, evaluate);
  const l = valueIn(lower, quantity, evaluate);
  if (u === undefined || l === undefined) return undefined;
  return u + 1e-12 < l
    ? `The ${words.upper} is below the ${words.lower}. Swap them, or raise the upper one.`
    : undefined;
}

/** `H7` → `{ letter: 'H', grade: 7 }` */
export function splitClass(c: string | undefined): { letter: string; grade: number } | undefined {
  const m = c ? /^([A-Za-z]{1,2})(\d{1,2})$/.exec(c) : null;
  return m ? { letter: m[1] as string, grade: Number(m[2]) } : undefined;
}

/** A signed deviation as drawn: `+0.021`, `−0.007`, `0`. */
export function signedMm(n: number): string {
  if (Math.abs(n) < 5e-7) return '0';
  const t = numText(Math.round(Math.abs(n) * 1e6) / 1e6);
  return `${n < 0 ? '−' : '+'}${t}`;
}
