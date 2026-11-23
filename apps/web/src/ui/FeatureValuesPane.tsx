/**
 * The selected feature's values as inline fields, for the phone's Features tab (review layout with
 * `editValues`). The field list is `exprFields`, the one the inspector, the parameter usage list
 * and configurations share; the write is a JSON-pointer replace on the feature, committed through
 * `Workbench.updateFeature` (one undo step per committed value, configuration-aware). Lazy chunk.
 */

import type { Expr, Feature } from '@wren-cad/contracts';
import { applyPatch, exprFields, fieldLabel, getAt } from '@wren-cad/document';
import { FeatureValues } from '@wren-cad/ui';
import { useMemo } from 'react';
import type { Workbench } from '../app/workbench';
import BeforeChip from './BeforeChip';

function withValue(f: Feature, pointer: string, expr: Expr): Feature {
  return applyPatch(f, [{ op: 'replace', path: pointer, value: expr }]).doc;
}

export default function FeatureValuesPane({
  wb,
  feature,
  lengthUnit,
  angleUnit,
}: {
  wb: Workbench;
  /** The feature as the active configuration shows it. */
  feature: Feature;
  lengthUnit: string;
  angleUnit: string;
}) {
  const fields = useMemo(
    () =>
      feature.type === 'sketch'
        ? []
        : exprFields(feature)
            .filter((x) => !x.driven)
            .map((x) => ({
              pointer: x.pointer,
              label: fieldLabel(feature.type, x.pointer),
              value: String(getAt(feature, x.pointer)),
              expected: x.expected,
            })),
    [feature],
  );
  return (
    <>
      <FeatureValues
        key={feature.id}
        name={feature.name}
        fields={fields}
        evaluate={(e, d) => wb.evaluate(e, d)}
        units={{ length: lengthUnit, angle: angleUnit }}
        onPreview={(pointer, expr) =>
          wb.updateFeature(withValue(feature, pointer, expr), 'preview')
        }
        onCommit={(pointer, expr) => wb.updateFeature(withValue(feature, pointer, expr), 'commit')}
        onDone={() => wb.selectFeature(null)}
      />
      <div className="flex justify-end px-4 pb-2">
        <BeforeChip wb={wb} />
      </div>
    </>
  );
}
