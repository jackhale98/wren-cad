import type { EvalResult, Expr, NamedDimension } from '@wren-cad/contracts';
import { Check } from 'lucide-react';
import { Field } from '../components/controls';
import { ExpressionInput } from '../components/ExpressionInput';
import { Button } from '../components/primitives';
import type { FormatValue } from '../format';

/** One numeric/expression value of a feature (a row of `exprFields`, with its label). */
export interface FeatureValueField {
  /** JSON pointer into the feature (`/end/depth`); the key and the `data-pointer`. */
  pointer: string;
  label: string;
  value: Expr;
  expected: NamedDimension;
}

const LABELS: Readonly<Record<string, string>> = {
  '/dx': 'Size X',
  '/dy': 'Size Y',
  '/dz': 'Size Z',
  '/radius': 'Radius',
  '/height': 'Height',
  '/end/depth': 'Depth',
  '/draft': 'Draft angle',
  '/angle': 'Angle',
  '/mode/distance': 'Distance',
  '/mode/angle': 'Angle',
  '/distance': 'Distance',
  '/thickness': 'Thickness',
  '/count': 'Count',
  '/spacing': 'Spacing',
  '/second/count': 'Second count',
  '/second/spacing': 'Second spacing',
  '/diameter': 'Diameter',
  '/tipAngle': 'Tip angle',
  '/counterbore/diameter': 'Counterbore diameter',
  '/counterbore/depth': 'Counterbore depth',
  '/countersink/diameter': 'Countersink diameter',
  '/countersink/angle': 'Countersink angle',
  '/thread/depth': 'Thread depth',
  '/definition/distance': 'Distance',
  '/definition/angle': 'Angle',
  '/definition/at/t': 'Position',
  '/definition/t': 'Position',
  '/definition/x': 'X',
  '/definition/y': 'Y',
  '/definition/z': 'Z',
};

/** The label the inspector shows for a value of a feature (its last segment when unknown). */
export function featureValueLabel(pointer: string): string {
  const known = LABELS[pointer];
  if (known) return known;
  const last = pointer.split('/').pop() ?? pointer;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export interface FeatureValuesProps {
  /** The feature's name (the pane's title). */
  name: string;
  fields: readonly FeatureValueField[];
  evaluate(expr: Expr, expected: NamedDimension): EvalResult;
  formatValue?: FormatValue;
  units: { length: string; angle: string };
  /** Live preview of a valid value (no undo step). */
  onPreview?(pointer: string, expr: Expr): void;
  /** A committed value: one undo step. */
  onCommit(pointer: string, expr: Expr): void;
  onDone?(): void;
  size?: 'md' | 'touch';
}

/**
 * The values of one feature as inline fields (phone review layout: change a number, no structural
 * edit). Not a dialog: it sits in the sheet above the tree. Fields accept expressions with units
 * and open the numeric keypad on touch, like the inspector's.
 */
export function FeatureValues({
  name,
  fields,
  evaluate,
  formatValue,
  units,
  onPreview,
  onCommit,
  onDone,
  size = 'touch',
}: FeatureValuesProps) {
  return (
    <section
      aria-label={`Values of ${name}`}
      data-testid="feature-values"
      className="mx-1 mb-2 flex flex-col gap-2 rounded-[12px] bg-surface-2 p-3"
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-ui font-semibold">{name}</h3>
        {onDone ? (
          <Button size={size} variant="ghost" icon={<Check className="size-4" />} onClick={onDone}>
            Done
          </Button>
        ) : null}
      </div>
      {fields.length === 0 ? (
        <p className="text-2xs leading-4 text-fg-muted">This feature has no values to edit here.</p>
      ) : (
        fields.map((f) => (
          <Field key={f.pointer} label={f.label} pointer={f.pointer}>
            <ExpressionInput
              label={f.label}
              value={f.value}
              evaluate={(e) => evaluate(e, f.expected)}
              formatValue={formatValue}
              unitHint={
                f.expected === 'length'
                  ? units.length
                  : f.expected === 'angle'
                    ? units.angle
                    : undefined
              }
              step={f.expected === 'angle' ? 5 : 1}
              size={size}
              // Values edit; they never add parameters (a structural edit). Typing the name of an
              // existing parameter still links to it.
              paramLinks="complete"
              onPreview={(e) => onPreview?.(f.pointer, e)}
              onCommit={(e) => onCommit(f.pointer, e)}
            />
          </Field>
        ))
      )}
    </section>
  );
}
