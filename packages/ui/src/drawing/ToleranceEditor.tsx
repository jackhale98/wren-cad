import type { DimensionText, EvalResult, Expr, Tolerance } from '@wren-cad/contracts';
import {
  dimensionLabel,
  evaluateTolerance,
  type NumberStyle,
  type SizeSymbol,
} from '@wren-cad/drawing/annotation';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Field, fieldClass, Segmented, Switch } from '../components/controls';
import { ExpressionInput } from '../components/ExpressionInput';
import { cn } from '../components/primitives';
import { LabelSvg } from './LabelSvg';
import { ToleranceField } from './ToleranceField';
import {
  type FitSupport,
  numberExpr,
  numText,
  pairProblem,
  signedMm,
  splitClass,
  switchTolerance,
  TOLERANCE_TYPE_HELP,
  TOLERANCE_TYPE_NAMES,
  TOLERANCE_TYPES,
  type ToleranceType,
  toleranceExpr,
  toleranceType,
  unitOf,
  valueIn,
} from './toleranceModel';

/** How the sheet writes numbers and how tall its dimension text is (the drawing's style). */
export interface LabelStyle {
  numbers: NumberStyle;
  /** Dimension text height, sheet mm. */
  textHeight: number;
}

/** The ISO preset's numbers, used when the host gives none. */
export const DEFAULT_LABEL_STYLE: LabelStyle = {
  numbers: {
    decimal: '.',
    lengthPrecision: 2,
    anglePrecision: 1,
    trailingZeros: 'strip',
    angleFormat: 'decimal',
  },
  textHeight: 3.5,
};

/** What of the dimension reaches its label besides the tolerance. */
export interface LabelContext {
  size?: SizeSymbol;
  text?: DimensionText;
  count?: number;
}

export interface ToleranceEditorProps {
  value: Tolerance | undefined;
  nominal?: Expr;
  quantity?: 'length' | 'angle';
  /** The dimension's value in mm (degrees for an angle); absent while it needs attention. */
  measured?: number;
  evaluate(expr: Expr): EvalResult;
  /** ISO 286; without it fits can be typed but not chosen. */
  fits?: FitSupport;
  /** Why a fit is refused on this dimension (`annotationIssues`' reason); undefined when fine. */
  fitDisabled?: string;
  /** The inspection switch; omitted for annotations that have none (hole callouts). */
  inspection?: { checked: boolean; onChange(on: boolean): void };
  labelStyle?: LabelStyle;
  labelContext?: LabelContext;
  onCommit(result: { nominal?: Expr; tolerance: Tolerance | null }): void;
  size?: 'md' | 'touch';
  label?: string;
}

const SAMPLE = 25;

/** The tolerance each tile shows, in the sheet's own drawing. */
function sampleTolerance(type: ToleranceType, quantity: 'length' | 'angle') {
  const d = quantity === 'angle' ? Math.PI / 360 : 0.2;
  const e = quantity === 'angle' ? Math.PI / 720 : 0.1;
  switch (type) {
    case 'none':
      return undefined;
    case 'symmetric':
      return { kind: 'symmetric' as const, value: e };
    case 'bilateral':
      return { kind: 'bilateral' as const, upper: d, lower: -e };
    case 'limits':
      return { kind: 'limits' as const, upper: d, lower: -e };
    case 'fit':
      return {
        kind: 'fit' as const,
        hole: 'H7',
        show: 'symbol' as const,
      };
    case 'basic':
      return { kind: 'basic' as const };
    case 'reference':
      return { kind: 'reference' as const };
  }
}

const sampleValue = (q: 'length' | 'angle') => (q === 'angle' ? (30 * Math.PI) / 180 : SAMPLE);

function TypeTiles({
  value,
  onChange,
  quantity,
  style,
  fitDisabled,
  size,
  label,
}: {
  value: ToleranceType;
  onChange(t: ToleranceType): void;
  quantity: 'length' | 'angle';
  style: LabelStyle;
  fitDisabled: string | undefined;
  size: 'md' | 'touch';
  label: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = TOLERANCE_TYPES.filter((t) => !(t === 'fit' && fitDisabled));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = enabled.indexOf(value);
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (i - 1 + enabled.length) % enabled.length;
    else return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target);
    requestAnimationFrame(() =>
      group.current?.querySelector<HTMLElement>(`[data-value="${target}"]`)?.focus(),
    );
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className="grid grid-cols-4 gap-0.5 rounded-[10px] bg-surface-2 p-0.5"
      data-testid="tolerance-types"
    >
      {TOLERANCE_TYPES.map((t) => {
        const on = t === value;
        const off = t === 'fit' && !!fitDisabled;
        const sample = sampleTolerance(t, quantity);
        return (
          // biome-ignore lint/a11y/useSemanticElements: radio semantics on a button for styling
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={t}
            aria-label={TOLERANCE_TYPE_NAMES[t]}
            disabled={off}
            title={off ? fitDisabled : TOLERANCE_TYPE_HELP[t]}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t)}
            className={cn(
              'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[8px] px-1 py-1 text-2xs font-medium transition-colors duration-fast disabled:opacity-40',
              size === 'touch' ? 'min-h-11' : 'min-h-10',
              on
                ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(15_23_42/0.14)]'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <span className="flex h-9 items-center justify-center">
              <LabelSvg
                label={dimensionLabel({
                  value: sampleValue(quantity),
                  quantity,
                  numbers: style.numbers,
                  ...(sample ? { tolerance: sample } : {}),
                  fitDeviations: () => undefined,
                })}
                h={style.textHeight}
                scale={size === 'touch' ? 3.8 : 3.4}
                className="max-w-full"
                decorative
              />
            </span>
            <span className="max-w-full truncate">{TOLERANCE_TYPE_NAMES[t]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The one-line explanation under a field or the tiles. */
const Note = ({ id, children, danger }: { id?: string; children: string; danger?: boolean }) => (
  <p
    id={id}
    role={danger ? 'alert' : undefined}
    className={cn('text-2xs', danger ? 'text-danger-text' : 'text-fg-subtle')}
  >
    {children}
  </p>
);

/**
 * The structured tolerance editor (replaces the single free-text field): choose the type first,
 * each drawn as it will look on the sheet, then the fields of that type only, a live preview drawn
 * by the sheet's own label layout, the inspection switch, and "Type it" as the quick entry.
 *
 * Switching type keeps what can be kept (`switchTolerance`) and never touches the nominal. Every
 * commit is one `onCommit`, so one undo step.
 */
export function ToleranceEditor({
  value,
  nominal,
  quantity = 'length',
  measured,
  evaluate,
  fits,
  fitDisabled,
  inspection,
  labelStyle = DEFAULT_LABEL_STYLE,
  labelContext,
  onCommit,
  size = 'md',
  label = 'Tolerance',
}: ToleranceEditorProps) {
  const type = toleranceType(value);
  const unit = unitOf(quantity);
  const id = useId();
  const norm = (t: string) => toleranceExpr(t, quantity);
  const ev = (t: string) => evaluate(norm(t));
  const commit = (tolerance: Tolerance | null) => onCommit({ tolerance });
  const ctx = { quantity, evaluate, ...(measured !== undefined ? { size: measured } : {}) };
  const fitCtx = fits ? { ...ctx, fits } : ctx;

  // A pair that was refused (upper below lower) stays on screen with its message.
  const [pair, setPair] = useState<{ upper: string; lower: string } | null>(null);
  const storedKey = JSON.stringify(value ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the stored value changes
  useEffect(() => setPair(null), [storedKey]);

  const choose = (to: ToleranceType) => {
    if (to === type) return;
    const next = switchTolerance(value, to, fitCtx);
    if (next === undefined) return;
    commit(next);
  };

  const evalStored = (e: Expr) => valueIn(e, quantity, evaluate);
  const input = (
    inputLabel: string,
    text: string,
    onText: (t: string) => void,
    disabled?: boolean,
    testId?: string,
  ) => (
    <ExpressionInput
      label={inputLabel}
      value={text}
      evaluate={ev}
      unitHint={unit}
      onCommit={onText}
      size={size}
      paramLinks="complete"
      showValue={false}
      step={quantity === 'angle' ? 0.1 : 0.01}
      {...(disabled ? { disabled } : {})}
      {...(testId ? { testId } : {})}
    />
  );

  /* -------- the fields of the chosen type */
  let fields: React.ReactNode = null;
  let problem: string | undefined;
  if (value?.kind === 'symmetric') {
    fields = (
      <Field label="Plus and minus (±)">
        {input('Symmetric tolerance', value.value, (t) => {
          // ± takes a size: a typed sign is dropped, and zero (or what cannot be read) is not a
          // tolerance, so the field keeps its last value.
          const unsigned = norm(t.trim().replace(/^[+\-−–]\s*/, ''));
          const r = evaluate(unsigned);
          if (r.ok && typeof r.value === 'number' && r.value > 0) {
            commit({ kind: 'symmetric', value: unsigned });
          }
        })}
      </Field>
    );
  } else if (value?.kind === 'bilateral') {
    const up = pair?.upper ?? value.upper;
    const lo = pair?.lower ?? value.lower;
    problem = pair ? pairProblem(norm(up), norm(lo), quantity, evaluate) : undefined;
    const set = (u: string, l: string) => {
      if (pairProblem(norm(u), norm(l), quantity, evaluate)) setPair({ upper: u, lower: l });
      else {
        setPair(null);
        commit({ kind: 'bilateral', upper: norm(u), lower: norm(l) });
      }
    };
    fields = (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Upper (+0.2)">{input('Upper deviation', up, (t) => set(t, lo))}</Field>
        <Field label="Lower (−0.1)">{input('Lower deviation', lo, (t) => set(up, t))}</Field>
      </div>
    );
  } else if (value?.kind === 'limits') {
    const devUp = evalStored(value.upper);
    const devLo = evalStored(value.lower);
    const known = measured !== undefined;
    const limit = (dev: number | undefined) =>
      known && dev !== undefined ? numText(Math.round((measured + dev) * 1e9) / 1e9) : '';
    const up = pair?.upper ?? limit(devUp);
    const lo = pair?.lower ?? limit(devLo);
    const toDev = (t: string): number | undefined => {
      const v = valueIn(norm(t), quantity, evaluate);
      return v === undefined || measured === undefined ? undefined : v - measured;
    };
    problem = pair
      ? pairProblem(norm(up), norm(lo), quantity, evaluate, {
          upper: 'upper limit',
          lower: 'lower limit',
        })
      : undefined;
    const set = (u: string, l: string) => {
      const du = toDev(u);
      const dl = toDev(l);
      if (du === undefined || dl === undefined) return;
      if (du + 1e-12 < dl) setPair({ upper: u, lower: l });
      else {
        setPair(null);
        commit({
          kind: 'limits',
          upper: numberExpr(du, quantity),
          lower: numberExpr(dl, quantity),
        });
      }
    };
    fields = known ? (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Upper limit">{input('Upper limit', up, (t) => set(t, lo))}</Field>
        <Field label="Lower limit">{input('Lower limit', lo, (t) => set(up, t))}</Field>
      </div>
    ) : (
      <Note>
        Limits are sizes, written from the dimension’s value. This dimension has none yet: attach it
        to geometry or state a value.
      </Note>
    );
  } else if (value?.kind === 'fit') {
    fields = (
      <FitFields
        value={value}
        size={size}
        sizeMm={quantity === 'length' ? measured : undefined}
        fits={fits}
        onChange={commit}
        id={id}
      />
    );
  }

  /* -------- the preview, from the sheet's label layout */
  const lookup = useMemo(
    () =>
      fits
        ? (c: string, v: number) => {
            const r = fits.deviations(c, v);
            return r.ok ? { upper: r.upper, lower: r.lower } : undefined;
          }
        : undefined,
    [fits],
  );
  const tolValue = value
    ? evaluateTolerance(value, (e) => {
        const r = evaluate(e);
        return r.ok ? r.value : undefined;
      })
    : undefined;
  const inspected = inspection?.checked === true && type !== 'reference';
  const previewLabel = dimensionLabel({
    ...(measured !== undefined
      ? { value: quantity === 'angle' ? (measured * Math.PI) / 180 : measured }
      : {}),
    quantity,
    ...(labelContext?.size ? { size: labelContext.size } : {}),
    ...(tolValue ? { tolerance: tolValue } : {}),
    ...(labelContext?.text ? { text: labelContext.text } : {}),
    ...(labelContext?.count !== undefined ? { count: labelContext.count } : {}),
    ...(inspected ? { inspection: true } : {}),
    numbers: labelStyle.numbers,
    ...(lookup ? { fitDeviations: lookup } : {}),
  });

  const insReason =
    type === 'reference'
      ? 'A reference dimension is information only and is not checked, so it cannot be an inspection dimension.'
      : undefined;

  return (
    <div className="flex flex-col gap-2.5" data-testid="tolerance-editor">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <TypeTiles
          value={type}
          onChange={choose}
          quantity={quantity}
          style={labelStyle}
          fitDisabled={fitDisabled}
          size={size}
          label={`${label} type`}
        />
        <Note>{TOLERANCE_TYPE_HELP[type]}</Note>
        {fitDisabled ? <Note>{`Fit unavailable: ${fitDisabled}`}</Note> : null}
      </div>

      {fields}
      {problem ? <Note danger>{problem}</Note> : null}

      {inspection ? (
        <div className="flex flex-col gap-1">
          <Switch
            checked={inspection.checked && type !== 'reference'}
            onChange={inspection.onChange}
            disabled={type === 'reference'}
            describedBy={insReason ? `${id}-ins` : `${id}-ins-help`}
            label="Inspection dimension"
          />
          <Note id={insReason ? `${id}-ins` : `${id}-ins-help`}>
            {insReason ??
              'Draws the value and its tolerance in a frame with rounded ends: this size is checked at inspection (ISO 129-1).'}
          </Note>
        </div>
      ) : null}

      <div className="flex flex-col gap-1" data-testid="tolerance-preview">
        <span className="text-xs font-medium text-fg-muted">On the sheet</span>
        <div className="flex min-h-12 items-center rounded-control bg-surface-2 px-3 py-2 text-fg">
          <LabelSvg
            label={previewLabel}
            h={labelStyle.textHeight}
            scale={size === 'touch' ? 6 : 5}
            className="max-w-full"
            testId="tolerance-preview-svg"
          />
        </div>
      </div>

      <ToleranceField
        value={value}
        {...(nominal !== undefined ? { nominal } : {})}
        quantity={quantity}
        {...(measured !== undefined ? { measured } : {})}
        size={size}
        label="Type it"
        onCommit={onCommit}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- fit */

type FitTol = Extract<Tolerance, { kind: 'fit' }>;

const SHOW: { value: FitTol['show']; label: string; title: string }[] = [
  { value: 'symbol', label: 'Symbol', title: 'Symbol only: H7' },
  { value: 'symbolAndDeviations', label: 'Deviations', title: 'Symbol with its deviations' },
  { value: 'limitsAndSymbol', label: 'Limits', title: 'Limits with the symbol' },
];

function FitFields({
  value,
  sizeMm,
  fits,
  onChange,
  size,
  id,
}: {
  value: FitTol;
  sizeMm: number | undefined;
  fits: FitSupport | undefined;
  onChange(t: Tolerance): void;
  size: 'md' | 'touch';
  id: string;
}) {
  if (sizeMm === undefined || !fits) {
    return (
      <Note>
        {fits
          ? 'Fit classes depend on the size, and this dimension has no value yet: attach it to geometry or state a value. You can still type a class below.'
          : 'Fit classes can be typed below.'}
      </Note>
    );
  }
  const outside = fits.choices('hole', sizeMm).length === 0;
  const dev = (c: string | undefined) => {
    if (!c) return undefined;
    const r = fits.deviations(c, sizeMm);
    return r.ok ? `${c}: ${signedMm(r.upper)} / ${signedMm(r.lower)} mm` : `${c}: ${r.reason}`;
  };
  const known = [value.hole, value.shaft]
    .filter((c): c is string => !!c)
    .every((c) => fits.deviations(c, sizeMm).ok);
  const set = (side: 'hole' | 'shaft', cls: string | undefined) => {
    const next: FitTol = { ...value };
    if (cls === undefined) delete next[side];
    else next[side] = cls;
    if (!next.hole && !next.shaft) return;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2" data-testid="fit-fields">
      {outside ? (
        <Note
          danger
        >{`${sizeMm} mm is outside the ISO 286 table (up to ${fits.maxSize} mm): there are no classes to choose. Type one below to draw the symbol.`}</Note>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <ClassPicker
            side="hole"
            label="Hole"
            current={value.hole}
            other={value.shaft}
            sizeMm={sizeMm}
            fits={fits}
            size={size}
            onChange={(c) => set('hole', c)}
          />
          <ClassPicker
            side="shaft"
            label="Shaft"
            current={value.shaft}
            other={value.hole}
            sizeMm={sizeMm}
            fits={fits}
            size={size}
            onChange={(c) => set('shaft', c)}
          />
        </div>
      )}
      <div data-testid="fit-deviations" className="flex flex-col gap-0.5">
        {[value.hole, value.shaft].map((c) =>
          c ? (
            <p key={c} className="tnum text-2xs text-fg-muted">
              {dev(c)}
            </p>
          ) : null,
        )}
        <p className="text-2xs text-fg-subtle">
          ISO 286 values are provisional (computed from the standard’s formulas).
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span id={`${id}-show`} className="text-xs font-medium text-fg-muted">
          Show on the sheet
        </span>
        <Segmented
          label="Fit display"
          size={size}
          value={value.show}
          onChange={(show) => onChange({ ...value, show })}
          options={SHOW.map((o) => ({
            value: o.value,
            label: o.label,
            title: o.title,
            disabled: o.value !== 'symbol' && !known,
          }))}
        />
        {!known ? (
          <Note>Deviations and limits need a class that has a value at this size.</Note>
        ) : null}
      </div>
    </div>
  );
}

function ClassPicker({
  side,
  label,
  current,
  other,
  sizeMm,
  fits,
  size,
  onChange,
}: {
  side: 'hole' | 'shaft';
  label: string;
  current: string | undefined;
  other: string | undefined;
  sizeMm: number;
  fits: FitSupport;
  size: 'md' | 'touch';
  onChange(cls: string | undefined): void;
}) {
  const choices = fits.choices(side, sizeMm);
  const cur = splitClass(current);
  const inTable = cur ? choices.find((c) => c.letter === cur.letter) : undefined;
  const grades = inTable?.grades ?? [];
  const pickGrade = (letter: string) => {
    const g = choices.find((c) => c.letter === letter)?.grades ?? [];
    const want = side === 'hole' ? 7 : 6;
    const keep = cur && g.includes(cur.grade) ? cur.grade : undefined;
    const grade = keep ?? (g.includes(want) ? want : g[Math.floor(g.length / 2)]);
    return grade === undefined ? undefined : `${letter}${grade}`;
  };
  const cls = size === 'touch' ? 'h-11' : 'h-8';
  return (
    <div className="flex flex-col gap-1" data-testid={`fit-${side}`}>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <select
          aria-label={`${label} letter`}
          value={cur?.letter ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : pickGrade(e.target.value))}
          className={cn(fieldClass, cls, 'px-1.5')}
        >
          <option value="" disabled={!other}>
            none
          </option>
          {cur && !inTable ? (
            <option value={cur.letter} disabled>
              {cur.letter} (no value here)
            </option>
          ) : null}
          {choices.map((c) => (
            <option key={c.letter} value={c.letter}>
              {c.letter}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} grade`}
          value={cur && grades.includes(cur.grade) ? String(cur.grade) : ''}
          disabled={!cur}
          onChange={(e) => cur && onChange(`${cur.letter}${e.target.value}`)}
          className={cn(fieldClass, cls, 'w-[3.75rem] px-1.5')}
        >
          {cur && !grades.includes(cur.grade) ? (
            <option value="" disabled>
              IT{cur.grade}
            </option>
          ) : null}
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
