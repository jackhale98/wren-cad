/**
 * The review layout's inline value editing, from capabilities (ADR-101, phase 2c): the Features
 * tab's values pane for the selected feature. Kept out of App.tsx; the gates are in
 * `platform/value-edit`.
 */

import type { DeviceCapabilities, WrenDoc } from '@wren-cad/contracts';
import { lazy, type ReactNode, Suspense } from 'react';
import { useObservable } from '../app/observable';
import type { Workbench } from '../app/workbench';
import { inlineFeatureValues } from '../platform/value-edit';

const FeatureValuesPane = lazy(() => import('./FeatureValuesPane'));

/** The selected feature's values pane, or undefined (nothing selected, a sketch, or not allowed). */
export function useFeatureValues(
  wb: Workbench,
  doc: WrenDoc,
  caps: DeviceCapabilities,
): ReactNode | undefined {
  const ui = useObservable(wb.ui);
  if (!inlineFeatureValues(caps) || !ui.featureId || ui.sketch) return undefined;
  // The feature as the active configuration shows it (M3.7); Default's is the stored one.
  const f =
    wb.config.effectiveFeature(ui.featureId) ??
    doc.parts[0]?.features.find((x) => x.id === ui.featureId);
  if (!f || f.type === 'sketch') return undefined;
  return (
    <Suspense fallback={null}>
      <FeatureValuesPane
        wb={wb}
        feature={f}
        lengthUnit={doc.units.length}
        angleUnit={doc.units.angle === 'deg' ? '°' : 'rad'}
      />
    </Suspense>
  );
}
